#!/usr/bin/env python3
# Helyi leiratkészítés (faster-whisper, CPU) a membership manifest alapján.
# Bemenet: argv[1] = JSON {root, language, model, max_items, max_seconds}
# Kimenet: soronként JSON események; az utolsó sor az összegzés.
import json, os, sys, time

cfg = json.loads(sys.argv[1])
root = cfg["root"]
mf = os.path.join(root, "manifest.json")
m = json.load(open(mf, encoding="utf-8"))
raw_dir = os.path.join(root, "transcripts", "raw")
os.makedirs(raw_dir, exist_ok=True)

todo = [x for x in m.get("media", {}).values()
        if x.get("status") == "done" and x.get("kind") in ("audio", "video")
        and not x.get("raw_transcript") and (x.get("transcribe_attempts") or 0) < 2]
if not todo:
    print(json.dumps({"ok": True, "done": 0, "remaining": 0}))
    sys.exit(0)

from faster_whisper import WhisperModel
model = WhisperModel(cfg.get("model", "medium"), device="cpu", compute_type="int8",
                     download_root=os.path.join(os.environ.get("STT_CORPUS_ROOT", "/stt-corpus"), "_models"))

start = time.time()
done = 0
for item in todo[: int(cfg.get("max_items", 3))]:
    if time.time() - start > float(cfg.get("max_seconds", 5 * 3600)):
        break
    src = os.path.join(root, item["file"])
    name = os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(raw_dir, f"{item['page_slug']}--{name}.txt")
    try:
        segs, info = model.transcribe(src, language=cfg.get("language", "hu"), vad_filter=True, beam_size=5)
        paras, cur, last_end = [], [], 0.0
        for s in segs:
            if cur and s.start - last_end > 1.5:
                paras.append(" ".join(cur)); cur = []
            cur.append(s.text.strip()); last_end = s.end
        if cur: paras.append(" ".join(cur))
        text = "\n\n".join(p for p in paras if p)
        if not text.strip():
            raise RuntimeError("üres leirat")
        open(out, "w", encoding="utf-8").write(text)
        item["raw_transcript"] = os.path.relpath(out, root)
        item["duration_sec"] = round(info.duration)
        item["transcribed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        done += 1
        print(json.dumps({"event": "ok", "file": item["file"], "chars": len(text)}), flush=True)
    except Exception as e:
        item["transcribe_attempts"] = (item.get("transcribe_attempts") or 0) + 1
        item["transcribe_error"] = str(e)[:500]
        print(json.dumps({"event": "error", "file": item["file"], "error": str(e)[:300]}), flush=True)
    tmp = mf + ".tmp"
    json.dump(m, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    os.replace(tmp, mf)

remaining = len([x for x in m["media"].values() if x.get("status") == "done"
                 and x.get("kind") in ("audio", "video") and not x.get("raw_transcript")
                 and (x.get("transcribe_attempts") or 0) < 2])
print(json.dumps({"ok": True, "done": done, "remaining": remaining}))
