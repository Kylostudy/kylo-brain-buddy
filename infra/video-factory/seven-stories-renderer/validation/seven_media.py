"""VPS readback: decode full audio and require all actual measured frames.

Lossy AAC is compared to the decoded approved MP3 at the SAME sample rate and
zero start. No cross-correlation/stretching can disguise trimming or speed-up.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import seven_stories as seven


def waveform_metrics(reference, actual):
    if len(actual) < len(reference) or not reference:
        raise ValueError("seven_audio_truncated")
    dot = sum(a*b for a,b in zip(reference,actual))
    energy = sum(a*a for a in reference)
    actual_energy = sum(b*b for b in actual[:len(reference)])
    if not energy or not actual_energy:
        raise ValueError("seven_empty_waveform")
    similarity = dot/math.sqrt(energy*actual_energy)
    gain = math.sqrt(actual_energy/energy)
    error = math.sqrt(sum((a-b)**2 for a,b in zip(reference,actual))/energy)
    if similarity < .99 or not .95 <= gain <= 1.05 or error > .15:
        raise ValueError("seven_audio_waveform_mismatch")
    return {"similarity":round(similarity,6),"gain":round(gain,6),"relative_error":round(error,6),"reference_samples":len(reference),"actual_samples":len(actual),"sample_rate":48000,"comparison_start_ms":0}


def pcm(path):
    data = subprocess.check_output(["ffmpeg","-v","error","-xerror","-i",str(path),"-map","0:a:0","-ac","1","-ar","48000","-f","s16le","-"],timeout=240)
    out = array.array("h");out.frombytes(data)
    return out


def verify_layout(path, video):
    if Path(path).is_symlink():
        raise ValueError("seven_unsafe_layout")
    rows = [json.loads(line) for line in Path(path).read_text().splitlines()]
    lens = video["timeline"]["sceneFrames"]
    if len(rows) != sum(lens):
        raise ValueError("seven_layout_frames_missing")
    offset, expected_scene = 0, 0
    for frame,row in enumerate(rows):
        while frame >= offset + lens[expected_scene]:
            offset += lens[expected_scene]; expected_scene += 1
        if row.get("frame") != frame or row.get("story") != video["story"] or row.get("scene") != expected_scene:
            raise ValueError("seven_layout_frame_mismatch")
        records = row.get("records")
        if not isinstance(records,list) or not records or not any(r.get("kind")=="object" for r in records):
            raise ValueError("seven_layout_empty")
        for r in records:
            vals = [r.get(k) for k in ("left","right","top","bottom")]
            if any(type(n) not in (int,float) or not math.isfinite(n) for n in vals):
                raise ValueError("seven_layout_bounds_missing")
            a,b,c,d = vals
            if not 65 <= a < b <= 950 or not 231 <= c < d <= 1459:
                raise ValueError("seven_unsafe_bounds")
        for i,a in enumerate(records):
            for b in records[i+1:]:
                if "text" not in (a.get("kind"),b.get("kind")):
                    continue
                if a["left"] < b["right"] and a["right"] > b["left"] and a["top"] < b["bottom"] and a["bottom"] > b["top"]:
                    raise ValueError("seven_layout_overlap")
        ms = frame*1000/30
        sub = next((s for s in video["timeline"]["subtitles"] if s["start_ms"] <= ms < s["end_ms"]),None)
        expected_text = (sub["text"].replace("Kylóban","Kylo-ban").replace("Kylóval","Kylo-val").replace("Kájló","Kylo")) if sub else None
        texts = [r.get("text") for r in records if r.get("kind")=="text"]
        if expected_text and expected_text not in texts:
            raise ValueError("seven_caption_missing")
        if expected_scene == 5 and "Próbáld ki ingyen 14 napig!" not in texts:
            raise ValueError("seven_cta_missing")
        if expected_scene == 6 and not {"kylo.study","A te AI magántanárod"} <= set(texts):
            raise ValueError("seven_outro_missing")
    return {"frames":len(rows),"all_frames_checked":True,"safe_zone":seven.SAFE,"layout_sha256":hashlib.sha256(Path(path).read_bytes()).hexdigest()}


def verify(output, audio, layout, video):
    reference = pcm(audio)
    actual = pcm(output)
    t = video["timeline"]
    if abs(len(actual)/48-t["duration_ms"]) > 100 or len(actual)-len(reference) < 48000*2:
        raise ValueError("seven_full_audio_hold_required")
    return {"waveform":waveform_metrics(reference,actual),"layout":verify_layout(layout,video),"tight_cut":False,"original_audio_sha256":hashlib.sha256(Path(audio).read_bytes()).hexdigest()}


if __name__ == "__main__":
    import sys
    output,audio,layout,story = sys.argv[1:]
    result = verify(output,audio,layout,seven.template(story)["videos"][0])
    print(json.dumps(result))