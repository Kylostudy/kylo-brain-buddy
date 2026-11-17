"""Fail-closed recipe contract for exam-simulator-safe-v1 (scene exam-simulator-v1).

Only the single Hungarian vizsgaszimulator-hu-trial is accepted.  Every problem
is collected in one list (shared preflight rule) instead of stopping at the first.
"""
import re

RENDERER = "exam-simulator-safe-v1"
SCENE = "exam-simulator-v1"
RECIPE = "vizsgaszimulator-hu-trial"
VERSION = "v1"
VERSIONS = ("v1", "v2", "v3")
FPS = 30
WIDTH, HEIGHT = 1080, 1920
MIN_SCENE_FRAMES = 17          # the master fades 8 frames in and 8 out of every scene
MAX_TOTAL_FRAMES = 60 * FPS
BLACK_OUTRO_FRACTION = 0.55
KEY = re.compile(r"^[a-z0-9][a-z0-9_-]*(/[a-z0-9][a-z0-9_-]*)*$")
SHA = re.compile(r"^[a-f0-9]{64}$")

# Pinned inputs of the approved HU trial (KyLogic package v4).  Narration must never be regenerated.
PINNED = {
    "screens/magic-school-1-png": ("e9cdf2582f425eebcc86907970e15ed06ace2abc0b9275fef8d493541b6da3f4", 194627),
    "screens/magic-school-2-png": ("8e13245fede394ded526b8f81533ba62191d312d09d7fdfb8889032ad847044f", 36898),
    "screens/magic-school-5-png": ("3127975636659d9d95d9cbd5b008fe3d12f5af2e161f15542e500030416f0b23", 132973),
    "screens/magic-school-6-png": ("edec0aa6253b69a5ab01b43b61b68ff9988d8245cac5f27f5369f1decbc440a3", 224765),
    "audio/vo-hu-wav": ("4191ad3084f0a4316fbf34a37b3a77a6b7f6b42e9252a92c1428bd615d694a66", 2449098),
    "audio/whoosh-mp3": ("6af09290e91bec3cdca50ed617f3ec8822adba0d2af88de474aa17f4f5ed66bc", 60647),
    "audio/clock-mp3": ("f70f8d92e1fb3991e40b5c24644dc29b28f9d01405155d06949e37ed49e4d827", 134231),
    "audio/heartbeat-mp3": ("4f15d4ba0c2ba8c180d43f319cfecd9d71e86203e9aeb64b1343c5e494311ae1", 41175),
    "audio/chime-mp3": ("fcefab215e46358851807eba77e5c0f98045089836400fcddd6888c3b8e21973", 58662),
    "audio/music-mp3": ("123fd86a29ade6f34bc2a7247098ebdac33163d7992be9687ffef6932367c212", 590152),
}
# v2 (owner-approved, KyLogic 2026-11-17): only the narration changed (sentences 1-2 slower, 3-7 unchanged).
PINNED_BY_VERSION = {"v1": PINNED, "v2": dict(PINNED, **{
    "audio/vo-hu-wav": ("506cd25c8d8c9e491131ac3e9d72af3467e44bb167f6d45153f343eeebfaaff1", 2578458)}),
    # v3 (owner-approved, KyLogic 2026-11-17): sentence 2 split + slower, sentence 3 slightly slower; rest identical.
    "v3": dict(PINNED, **{
    "audio/vo-hu-wav": ("f7b47ae4bdb8ec9004520ccaddfa5a800326e18acd4b4feabf505d5de1216b4a", 2672538)})}
SCREENS = ["screens/magic-school-1-png", "screens/magic-school-2-png", "screens/magic-school-5-png", "screens/magic-school-6-png"]
AUDIO = {"vo": "audio/vo-hu-wav", "whoosh": "audio/whoosh-mp3", "clock": "audio/clock-mp3",
         "heartbeat": "audio/heartbeat-mp3", "chime": "audio/chime-mp3", "music": "audio/music-mp3"}
# Approved Hungarian copy, variant 4 (parents).  Order = on-screen order; scene 5 is silent.
CAPTIONS = [
    (1, "Holnap témazárót ír a gyereked?"),
    (2, "Este még tudja. Reggel már izgul."),
    (3, "Kylo megíratja vele a dolgozatot előre – a saját füzetéből."),
    (4, "Barátságosan, korrektül vagy szigorú professzorként."),
    (6, "Így a dolgozat már nem lesz ismeretlen."),
    (7, "Gyakorolja a dolgozatírást a Kylóval!"),
    (7, "kylo.study – a te AI magántanárod"),
]
CTA = {"text": "Gyakorolja a dolgozatírást a Kylóval!", "url": "kylo.study", "tagline": "a te AI magántanárod"}
TEXT = {"language": "hu", "variant": 4, "audience": "parent_facebook", "skin": "magic_school"}


def scene_bounds(frames):
    """Frame ranges [start, end) of the seven scenes."""
    out, s = [], 0
    for n in frames:
        out.append((s, s + n)); s += n
    return out


def ms(frame):
    return frame * 1000 / FPS


def black_outro_frame(frames):
    a, b = scene_bounds(frames)[6]
    return a + round((b - a) * BLACK_OUTRO_FRACTION)


def _scene_frames_errors(frames):
    if (not isinstance(frames, list) or len(frames) != 7
            or any(type(n) is not int or n < MIN_SCENE_FRAMES for n in frames)):
        return ["timing.sceneFrames: exactly 7 integers >= %d required" % MIN_SCENE_FRAMES]
    if sum(frames) > MAX_TOTAL_FRAMES:
        return ["timing.sceneFrames: total above %d frames" % MAX_TOTAL_FRAMES]
    return []


def diagnose(manifest):
    errors = []
    if not isinstance(manifest, dict):
        return ["manifest: object required"]
    version = manifest.get("version")
    if version not in VERSIONS:
        errors.append("version: must be one of %r" % (VERSIONS,))
    pinned = PINNED_BY_VERSION.get(version, PINNED)
    expect = {"recipe": RECIPE, "series": "other", "renderer": RENDERER}
    for k, v in expect.items():
        if manifest.get(k) != v:
            errors.append("%s: must be %r" % (k, v))
    if manifest.get("start_series", False) is not False:
        errors.append("start_series: forbidden for the trial")
    extra = set(manifest) - {"recipe", "version", "series", "renderer", "start_series", "files", "videos"}
    if extra:
        errors.append("manifest: unknown fields %s" % sorted(extra))

    files = manifest.get("files")
    by_key = {}
    if not isinstance(files, list):
        errors.append("files: list required"); files = []
    for i, f in enumerate(files):
        if not isinstance(f, dict) or set(f) != {"key", "bytes", "sha256"}:
            errors.append("files[%d]: exactly key/bytes/sha256 required" % i); continue
        key = f["key"]
        if not isinstance(key, str) or not KEY.fullmatch(key):
            errors.append("files[%d].key: unsafe path" % i); continue
        if key in by_key:
            errors.append("files[%d].key: duplicate %s" % (i, key))
        by_key[key] = f
        if not isinstance(f["sha256"], str) or not SHA.fullmatch(f["sha256"]):
            errors.append("files[%d].sha256: 64 lowercase hex required" % i)
        if type(f["bytes"]) is not int or f["bytes"] < 1:
            errors.append("files[%d].bytes: positive integer required" % i)
        if key not in pinned:
            errors.append("files[%d].key: not an approved trial input (%s)" % (i, key))
        elif (f["sha256"], f["bytes"]) != pinned[key]:
            errors.append("files[%d]: checksum/size differ from the approved %s" % (i, key))
    for key in pinned:
        if key not in by_key:
            errors.append("files: missing %s" % key)

    videos = manifest.get("videos")
    if not isinstance(videos, list) or len(videos) != 1:
        errors.append("videos: exactly one output allowed in the trial")
        videos = videos[:1] if isinstance(videos, list) else []
    for v in videos:
        errors += _video_errors(v)
    return errors


def _video_errors(v):
    errors = []
    if not isinstance(v, dict):
        return ["videos[0]: object required"]
    need = {"video_id", "language", "width", "height", "scene", "text", "subtitle", "cta", "audio", "screens", "timing"}
    if set(v) != need:
        errors.append("videos[0]: fields must be exactly %s" % sorted(need))
    if v.get("language") != "hu":
        errors.append("videos[0].language: only hu is approved")
    if v.get("scene") != SCENE:
        errors.append("videos[0].scene: unknown scene (must be %s)" % SCENE)
    if v.get("width") != WIDTH or v.get("height") != HEIGHT:
        errors.append("videos[0]: 1080x1920 required")
    if not isinstance(v.get("video_id"), str) or not KEY.fullmatch(v.get("video_id", "")):
        errors.append("videos[0].video_id: safe identifier required")
    if v.get("text") != TEXT:
        errors.append("videos[0].text: must equal the approved trial text block")
    if v.get("cta") != CTA:
        errors.append("videos[0].cta: must equal the approved Hungarian CTA")
    if v.get("screens") != SCREENS:
        errors.append("videos[0].screens: exactly the 4 approved checksummed screens in order")
    if v.get("audio") != AUDIO:
        errors.append("videos[0].audio: must map vo/whoosh/clock/heartbeat/chime/music to the approved keys")

    t = v.get("timing")
    if not isinstance(t, dict) or set(t) != {"fps", "sceneFrames", "duration_ms", "protected_windows_ms", "black_outro_start_ms"}:
        return errors + ["videos[0].timing: fields fps/sceneFrames/duration_ms/protected_windows_ms/black_outro_start_ms required"]
    if t.get("fps") != FPS:
        errors.append("timing.fps: must be 30")
    frame_errors = _scene_frames_errors(t.get("sceneFrames"))
    errors += frame_errors
    subs = v.get("subtitle")
    if not isinstance(subs, list) or len(subs) != len(CAPTIONS):
        return errors + ["videos[0].subtitle: exactly %d approved lines required" % len(CAPTIONS)]
    if frame_errors:
        return errors
    frames = t["sceneFrames"]
    total = sum(frames)
    if t.get("duration_ms") != int(ms(total)):
        errors.append("timing.duration_ms: must be %d for these sceneFrames" % int(ms(total)))
    bounds = scene_bounds(frames)
    s5 = bounds[4]
    if t.get("protected_windows_ms") != [[int(ms(s5[0])), int(ms(s5[1]))]]:
        errors.append("timing.protected_windows_ms: must be the silent scene 5 window [[%d, %d]]" % (int(ms(s5[0])), int(ms(s5[1]))))
    black = ms(black_outro_frame(frames))
    bo = t.get("black_outro_start_ms")
    if type(bo) is not int or abs(bo - black) > 1000 / FPS:
        errors.append("timing.black_outro_start_ms: must be within one frame of %.0f" % black)
    prev_end = -1
    for i, (sub, (scene, caption)) in enumerate(zip(subs, CAPTIONS)):
        if not isinstance(sub, dict) or set(sub) != {"scene", "start_ms", "end_ms", "text"}:
            errors.append("subtitle[%d]: exactly scene/start_ms/end_ms/text required" % i); continue
        if sub["scene"] != scene or sub["text"] != caption:
            errors.append("subtitle[%d]: must be the approved scene %d line" % (i, scene))
        a, b = sub["start_ms"], sub["end_ms"]
        if type(a) is not int or type(b) is not int or not 0 <= a < b:
            errors.append("subtitle[%d]: integer 0 <= start_ms < end_ms required" % i); continue
        if a < prev_end:
            errors.append("subtitle[%d]: overlaps the previous line" % i)
        prev_end = b
        lo, hi = bounds[scene - 1]
        if a < ms(lo) or b > ms(hi):
            errors.append("subtitle[%d]: outside its own scene %d (%d-%d ms)" % (i, scene, int(ms(lo)), int(ms(hi))))
        if scene == 5:
            errors.append("subtitle[%d]: scene 5 must stay silent" % i)
    if len(subs) == 7 and all(isinstance(s, dict) for s in subs[5:]):
        if isinstance(subs[5].get("end_ms"), int) and subs[5]["end_ms"] > black:
            errors.append("subtitle[5]: CTA must end before the black outro")
        if isinstance(subs[6].get("start_ms"), int) and subs[6]["start_ms"] < black - 1:
            errors.append("subtitle[6]: brand line must start on the black outro")
    return errors


def validate_trial(manifest):
    errors = diagnose(manifest)
    if errors:
        raise ValueError("exam_simulator_invalid: " + "; ".join(errors))
    return True


def validate_request(request):
    """Container entrypoint check: the rendered video must be the manifest's only video."""
    if not isinstance(request, dict) or set(request) != {"manifest", "video"}:
        raise ValueError("exam_simulator_invalid: request must hold manifest and video")
    validate_trial(request["manifest"])
    if request["video"] != request["manifest"]["videos"][0]:
        raise ValueError("exam_simulator_invalid: video is not the approved manifest output")
    return True
