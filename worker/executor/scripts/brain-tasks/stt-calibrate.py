#!/usr/bin/env python3
"""Helyi STT-kalibrálás a VPS-en.

Bemenet (argv[1]): JSON {language, model, max_samples, delete_after, corpus_root}
Kimenet (stdout utolsó sora): JSON eredmény — csak apró számok, nyers hang/szöveg nélkül.
A korpusz: <corpus_root>/<lang>/<id>.mp3 + <id>.txt (referencia-szöveg).
"""
import json, os, re, sys, time, unicodedata, datetime

def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"[^\w\s']", " ", s, flags=re.UNICODE)
    return s.split()

def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]

# Karakter-alapú hiba a szóköz nélküli írásokhoz (ja, zh, ko)
CHAR_LANGS = {"ja", "zh", "ko", "th"}

def main():
    cfg = json.loads(sys.argv[1])
    lang = cfg["language"][:2].lower()
    root = cfg.get("corpus_root", "/stt-corpus")
    # A letöltő <root>/<lang>/<id>.mp3 + <id>.txt párokat ment. Tűrjük a
    # "de-DE"/"de_DE"/"DE" mappaneveket és az almappákat is.
    dirs = []
    if os.path.isdir(root):
        for name in os.listdir(root):
            n = name.lower().replace("_", "-")
            if n == lang or n.startswith(lang + "-"):
                full = os.path.join(root, name)
                if os.path.isdir(full):
                    dirs.append(full)
    if not dirs:
        seen = sorted(x for x in os.listdir(root) if not x.startswith("_")) if os.path.isdir(root) else []
        print(json.dumps({"ok": False, "language": lang, "error": "nincs helyi korpusz ehhez a nyelvhez", "corpus_root": root, "root_exists": os.path.isdir(root), "dirs_seen": seen[:40]}))
        return
    audio, texts = {}, {}
    for dd in dirs:
        for cur, _, files in os.walk(dd):
            for f in files:
                stem, ext = os.path.splitext(f)
                ext = ext.lower()
                fp = os.path.join(cur, f)
                if ext in (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".opus"):
                    audio.setdefault(stem, fp)
                elif ext == ".txt" and os.path.getsize(fp) > 0:
                    texts.setdefault(stem, fp)
    pairs = sorted((k, audio[k], texts[k]) for k in audio if k in texts)
    pairs = pairs[: int(cfg.get("max_samples") or 300)]
    if not pairs:
        print(json.dumps({"ok": False, "language": lang, "error": "nincs hang+szöveg pár", "audio_files": len(audio), "text_files": len(texts), "audio_without_text": sorted(set(audio) - set(texts))[:10], "text_without_audio": sorted(set(texts) - set(audio))[:10]}))
        return

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        import traceback
        print(json.dumps({"ok": False, "language": lang, "error": "faster-whisper import hiba: " + repr(e), "trace": traceback.format_exc()[-1500:]}))
        return
    model_name = cfg.get("model") or "small"
    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         download_root=os.path.join(root, "_models"))

    errs = total = 0
    audio_sec = 0.0
    done = []
    t0 = time.time()
    for i, ap, tp in pairs:
        ref = open(tp, encoding="utf-8", errors="ignore").read()
        segs, info = model.transcribe(ap, language=lang, beam_size=1, vad_filter=True)
        hyp = " ".join(s.text for s in segs)
        audio_sec += float(getattr(info, "duration", 0) or 0)
        if lang in CHAR_LANGS:
            r, h = list("".join(norm(ref))), list("".join(norm(hyp)))
        else:
            r, h = norm(ref), norm(hyp)
        if not r:
            continue
        errs += edit_distance(r, h)
        total += len(r)
        done.append((ap, tp))

    if cfg.get("delete_after", True):
        for ap, tp in done:
            for fp in (ap, tp):
                try: os.remove(fp)
                except OSError: pass

    err_rate = errs / total if total else 1.0
    print(json.dumps({
        "ok": True,
        "language": lang,
        "accuracy_pct": round(max(0.0, 1 - err_rate) * 100, 2),
        "error_rate_pct": round(err_rate * 100, 2),
        "metric": "CER" if lang in CHAR_LANGS else "WER",
        "samples": len(done),
        "audio_hours": round(audio_sec / 3600, 2),
        "engine": "whisper",
        "model": model_name,
        "measured_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "elapsed_sec": round(time.time() - t0),
        "files_deleted": bool(cfg.get("delete_after", True)),
    }))

if __name__ == "__main__":
    main()
