"""Data-only contract for the single Hungarian piggy-bank trial."""
import json

RECIPE = "malacpersely-hu-trial"
RENDERER = "piggy-bank-safe-v1"
SCENE = "piggy-bank-v1"
COUNTER = [20, 35, 55, 80, 105]


def targeted(raw):
    videos = raw.get("videos")
    return raw.get("recipe_id") == RECIPE or raw.get("renderer") == RENDERER or any(
        isinstance(v, dict) and v.get("scene") == SCENE for v in (videos if isinstance(videos, list) else []))


def scene_frames(value):
    if not isinstance(value, list) or len(value) != 7 or any(type(n) is not int or not 1 <= n <= 18000 for n in value):
        raise ValueError("piggy_invalid_scene_frames")
    if sum(value) > 18000:
        raise ValueError("piggy_duration_limit")
    return value


def data(value, fields):
    try:
        result = json.loads(value)
    except (ValueError, TypeError):
        raise ValueError("piggy_invalid_json") from None
    if not isinstance(result, dict) or set(result) != set(fields):
        raise ValueError("piggy_unsupported_fields")
    return result


def validate(raw):
    if (raw.get("schema_version") != 1 or raw.get("recipe_id") != RECIPE or raw.get("renderer") != RENDERER
            or raw.get("series") != "other" or raw.get("languages") != ["hu"] or "continuation" in raw
            or not isinstance(raw.get("videos"), list) or len(raw["videos"]) != 1):
        raise ValueError("piggy_hu_trial_only")
    v = raw["videos"][0]
    if v.get("scene") != SCENE or v.get("language") != "hu" or (v.get("width"), v.get("height")) != (1080, 1920) or "font" in v:
        raise ValueError("piggy_invalid_scene")
    text = data(v.get("text"), {"heading", "disclaimer", "truth", "price", "steps", "counter_values", "labels", "outro_url", "outro_tagline"})
    for key in ("heading", "disclaimer", "truth", "price", "outro_url", "outro_tagline"):
        if not isinstance(text[key], str) or not text[key].strip() or len(text[key]) > 180:
            raise ValueError("piggy_invalid_text")
    if text["counter_values"] != COUNTER or text["price"] != "29,99 USD/hó":
        raise ValueError("piggy_invalid_offer")
    for key, count in (("steps", 4), ("labels", 5)):
        if not isinstance(text[key], list) or len(text[key]) != count or any(not isinstance(s, str) or not s.strip() or len(s) > 100 for s in text[key]):
            raise ValueError("piggy_invalid_text")
    if text["disclaimer"] != "Szemléltető előfizetési kosár. A tényleges díjak eltérhetnek." or text["truth"] != "Több mint 100 USD/hó":
        raise ValueError("piggy_illustrative_claim_required")
    cta = data(v.get("cta"), {"text", "supporting_text", "trial_days"})
    if cta != {"text": "Próbáld ki ingyen!", "supporting_text": "14 napos ingyenes próba", "trial_days": 14}:
        raise ValueError("piggy_invalid_cta")
    timing = v.get("timing")
    if not isinstance(timing, list) or len(timing) != 7:
        raise ValueError("piggy_invalid_scene_frames")
    end, frames = 0, []
    for t in timing:
        if not isinstance(t, dict) or set(t) != {"start_ms", "end_ms"} or type(t["start_ms"]) is not int or type(t["end_ms"]) is not int or t["start_ms"] != end:
            raise ValueError("piggy_invalid_timing")
        # Millisecond boundaries must be nearest-ms representations of exact 30fps frames.
        a, b = round(t["start_ms"] * 30 / 1000), round(t["end_ms"] * 30 / 1000)
        if abs(t["start_ms"] - a * 1000 / 30) > 0.501 or abs(t["end_ms"] - b * 1000 / 30) > 0.501:
            raise ValueError("piggy_invalid_timing")
        frames.append(b - a)
        end = t["end_ms"]
    scene_frames(frames)
    if end != v.get("duration_ms"):
        raise ValueError("piggy_invalid_timing")
    subtitles = data(v.get("subtitle"), {"subs"})["subs"]
    if not isinstance(subtitles, list) or len(subtitles) > 2000:
        raise ValueError("piggy_invalid_subtitles")
    last = 0
    for s in subtitles:
        if (not isinstance(s, dict) or set(s) != {"start_ms", "end_ms", "text"} or type(s["start_ms"]) is not int or type(s["end_ms"]) is not int
                or not last <= s["start_ms"] < s["end_ms"] <= timing[5]["end_ms"] or not isinstance(s["text"], str) or not s["text"].strip() or len(s["text"]) > 180):
            raise ValueError("piggy_invalid_subtitles")
        last = s["end_ms"]
    if v.get("audio") != "audio/vo-hu-mp3" or v.get("master") != "data/scene-frames-json":
        raise ValueError("piggy_invalid_media")
    names = {f["key"] for f in raw["files"]}
    if not {v["audio"], v["master"]} <= names or names - {v["audio"], v["master"], "audio/bed-mp3"}:
        raise ValueError("piggy_invalid_input_list")
    return frames