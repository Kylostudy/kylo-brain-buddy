"""VPS-only execution of version-two previews and append-only renders."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from contract import canonical
from inputs import readable_inputs
from storage import safe_path, checksum
from universal import FactoryError, check_layout, alignment, redact, RENDERER
from universal_state import commit, fail
from verify import verify_video


def probe_audio(path):
    result = subprocess.run(["/usr/bin/ffprobe", "-v", "error", "-show_format", "-of", "json", str(path)], check=True, capture_output=True, timeout=30)
    return round(float(json.loads(result.stdout)["format"]["duration"]) * 1000)


def self_check(config, manifest=None):
    checks = []
    for name, renderer in config.get("renderers", {}).items():
        if manifest and name != manifest["renderer"]: continue
        try:
            if not renderer.get("reviewed") or not str(renderer.get("image", "")).startswith("sha256:"):
                raise FactoryError("self_check", "renderer_review_required", "Unreviewed image", renderer=name)
            subprocess.run(["/usr/bin/docker", "image", "inspect", renderer["image"]], check=True, capture_output=True, timeout=30)
            subprocess.run(["/usr/bin/docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65532:65532", "--pids-limit", "32", "--memory", "128m", "--entrypoint", "/bin/echo", renderer["image"], "ok"], check=True, capture_output=True, timeout=30)
            checks.append({"stage": "self_check", "code": "image_ok", "renderer": name, "ok": True})
        except Exception as e:
            checks.append({"stage": "self_check", "code": "image_unavailable", "renderer": name, "ok": False, "message": type(e).__name__})
    for name in ("work_root", "archive_root"):
        usage = shutil.disk_usage(config[name])
        checks.append({"stage": "self_check", "code": "disk", "root": name, "free_bytes": usage.free, "ok": usage.free > config["min_free_bytes"] and usage.used / usage.total <= config["max_disk_fraction"]})
    if manifest:
        root = safe_path(config["recipe_root"], manifest["recipe_id"] + "/" + manifest["version"])
        try:
            readable_inputs(root, manifest["files"])
            checks.append({"stage": "asset_stage", "code": "permissions_ok", "ok": True})
        except Exception as e: checks.append({"stage": "asset_stage", "code": "input_unavailable", "ok": False, "message": str(e)[:200]})
        for v in manifest.get("videos", []):
            if manifest.get("schema_version") != 2: continue
            font = safe_path(root, v["font"])
            # Font glyph coverage is checked by the renderer against actual text.
            checks.append({"stage": "font_load", "code": "font_data", "language": v["language"], "file": v["font"], "ok": font.is_file() and font.stat().st_size > 0})
    return {"ok": bool(checks) and all(c["ok"] for c in checks), "checks": checks}


def preflight(config, job):
    m = job["manifest"]
    root = safe_path(config["recipe_root"], m["recipe_id"] + "/" + m["version"])
    declared = {f["key"]: f for f in m["files"]}
    missing = list(job["plan"]["missing"])
    for item in job["items"]:
        if item["status"] == "skipped" or not item["video"]: continue
        v = json.loads(item["video"])
        absent = []
        for key in ("audio", "alignment", "font", "dog", "bed"):
            if key not in v: continue
            f = declared.get(v[key]); path = safe_path(root, v[key])
            if not f or not path.is_file() or path.stat().st_size != f["bytes"] or checksum(path) != f["sha256"]: absent.append(key)
        if absent: missing.append({"language": item["language"], "missing": absent})
    if missing: raise FactoryError("asset_stage", "series_inputs_missing", "Missing inputs by language", missing=missing)
    result = self_check(config, m)
    if not result["ok"]: raise FactoryError("self_check", "preflight_failed", "Preflight checks failed", checks=result["checks"])
    # Validate every alignment and audio before producing any final output.
    for item in job["items"]:
        if item["status"] == "skipped": continue
        v = json.loads(item["video"])
        alignment(json.loads(safe_path(root, v["alignment"]).read_text()), probe_audio(safe_path(root, v["audio"])))
    return result


def save_qa(archive_root, key, work):
    """Publish only fixed QA files, immutable and hash-bound beside the MP4."""
    result = {}
    for artifact, suffix in (("contact", ".contact.jpg"), ("layout", ".layout.jsonl")):
        src = work / ("contact.jpg" if artifact == "contact" else "layout.jsonl")
        fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
        import stat
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 128 * 1024**2: raise FactoryError("qa_zone", "unsafe_qa_output", "Invalid QA file")
            dest = safe_path(archive_root, key, suffix)
            dest.parent.mkdir(parents=True, exist_ok=True)
            temp = dest.parent / (".qa-" + os.urandom(8).hex())
            try:
                with os.fdopen(os.dup(fd), "rb") as r, temp.open("xb") as w:
                    shutil.copyfileobj(r, w); w.flush(); os.fsync(w.fileno())
                digest = checksum(temp)
                try: os.link(temp, dest)
                except FileExistsError:
                    if checksum(dest) != digest: raise FactoryError("archive", "qa_conflict", "QA object already exists")
                result[artifact] = {"path": "videos/versioned-factory/" + key + suffix, "sha256": digest, "bytes": dest.stat().st_size}
            finally: temp.unlink(missing_ok=True)
        finally: os.close(fd)
    return result


def render_item(config, archive, job, item, mode):
    m, v = job["manifest"], json.loads(item["video"])
    renderer = config.get("renderers", {}).get(RENDERER)
    if not renderer or not renderer.get("reviewed") or renderer.get("scenes") != [RENDERER]: raise FactoryError("render", "renderer_review_required", "Universal renderer not installed")
    root = safe_path(config["recipe_root"], m["recipe_id"] + "/" + m["version"])
    audio_ms = probe_audio(safe_path(root, v["audio"]))
    captions = alignment(json.loads(safe_path(root, v["alignment"]).read_text()), audio_ms)
    work = Path(config["work_root"]) / job["id"] / item["language"] / mode
    work.mkdir(parents=True, exist_ok=True); os.chown(work, 65532, 65532); os.chmod(work, 0o700)
    request = work.parent / (mode + ".request.json")
    request.write_bytes(canonical({"manifest": m, "video": v, "mode": mode, "audio_ms": audio_ms, "captions": captions})); os.chmod(request, 0o644)
    # Stable scratch allows crash recovery without regenerating a completed render.
    if not (work / "complete.json").is_file():
        subprocess.run(["/usr/bin/docker", "run", "--rm", "--name", "kylo-video-factory-render", "--network", "none", "--cpus", str(config["cpus"]), "--memory", config["memory"], "--memory-swap", config["memory"], "--pids-limit", "256", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65532:65532", "--shm-size", "512m", "--tmpfs", "/tmp:rw,size=512m", "-e", "HOME=/tmp", "-e", "XDG_CONFIG_HOME=/tmp/.config", "-e", "XDG_CACHE_HOME=/tmp/.cache", "-v", str(root) + ":/recipe:ro", "-v", str(request) + ":/request.json:ro", "-v", str(work) + ":/work:rw", renderer["image"]], check=True, timeout=7200, capture_output=True)
    fd = os.open(work / "complete.json", os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream: complete = json.load(stream)
    fd = os.open(work / "layout.jsonl", os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream: records = [json.loads(line) for line in stream]
    expected = complete["preview_frames"] if mode == "preview" else range(complete["total_frames"])
    check_layout(records, m["safe_zone"], expected)
    qa_key = item["output_key"] + ("/preview" if mode == "preview" else "")
    qa = save_qa(config["archive_root"], qa_key, work)
    qa.update({"ok": True, "audio_ms": audio_ms, "total_frames": complete["total_frames"]})
    if mode == "preview": return qa, None
    fd = os.open(work / "output.mp4", os.O_RDONLY | os.O_NOFOLLOW)
    checked = work.parent / "checked.mp4"
    with os.fdopen(fd, "rb") as r, checked.open("wb") as w: shutil.copyfileobj(r, w)
    media = verify_video(checked, {"width": 1080, "height": 1920, "duration_ms": audio_ms + v["outro_ms"], "universal": True})
    media["qa"] = qa
    receipt = archive.save(item["output_key"], checked, media)
    return qa, receipt


def run(config, state, archive, job):
    try:
        if job["phase"] == "preflight":
            result = preflight(config, job)
            with state.transaction() as db: state.emit(db, "self_check", job["id"], result)
            commit(state, job, phase="preview"); return
        if job["phase"] == "preview":
            item = next((i for i in job["items"] if i["status"] == "pending"), None)
            if item:
                qa, _ = render_item(config, archive, job, item, "preview")
                commit(state, job, language=item["language"], preview=qa); return
            commit(state, job, phase="render"); return
        item = next((i for i in job["items"] if i["status"] == "previewed"), None)
        if item:
            # Existing final output after a crash is verified again, not regenerated.
            qa, receipt = render_item(config, archive, job, item, "render")
            commit(state, job, language=item["language"], receipt=receipt)
        else: commit(state, job, phase="render")
    except Exception as e:
        detail = dict(e.result) if isinstance(e, FactoryError) else {"stage": "render", "code": "render_failed", "message": str(e)[:400], "log_tail": []}
        stderr = getattr(e, "stderr", b"") or b""
        detail["log_tail"] = redact(stderr.decode("utf8", "replace") if isinstance(stderr, bytes) else stderr)
        detail["message"] = " ".join(redact(detail["message"]))
        detail["job_id"] = job["id"]
        fail(state, job, detail, blocked=detail["stage"] in {"asset_stage", "self_check", "font_load"})