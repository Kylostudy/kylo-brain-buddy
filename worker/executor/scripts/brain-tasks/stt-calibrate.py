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
    d = os.path.join(root, lang)
    if not os.path.isdir(d):
        print(json.dumps({"ok": False, "language": lang, "error": "nincs helyi korpusz ehhez a nyelvhez"}))
        return
    ids = sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mp3") and os.path.exists(os.path.join(d, f[:-4] + ".txt")))
    ids = ids[: int(cfg.get("max_samples") or 300)]
    if not ids:
        print(json.dumps({"ok": False, "language": lang, "error": "nincs hang+szöveg pár"}))
        return

    from faster_whisper import WhisperModel
    model_name = cfg.get("model") or "small"
    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         download_root=os.path.join(root, "_models"))

    errs = total = 0
    audio_sec = 0.0
    done = []
    t0 = time.time()
    for i in ids:
        ref = open(os.path.join(d, i + ".txt"), encoding="utf-8").read()
        segs, info = model.transcribe(os.path.join(d, i + ".mp3"), language=lang, beam_size=1, vad_filter=True)
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
        done.append(i)

    if cfg.get("delete_after", True):
        for i in done:
            for ext in (".mp3", ".txt"):
                try: os.remove(os.path.join(d, i + ext))
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
