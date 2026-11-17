"""Local ffmpeg audio layer for exam-simulator-v1: VO + approved effects + ducked music, -14 LUFS."""
import json, os, subprocess, sys

from exam_simulator import FPS, scene_bounds, validate_request

TARGET_LUFS = -14.0
TRUE_PEAK = -1.5


def filter_graph(frames, norm=None):
    total = sum(frames) / FPS
    b = scene_bounds(frames)
    sec = lambda f: f / FPS
    d = lambda s: int(round(s * 1000))
    cuts = [sec(a) for a, _ in b[1:]]          # whoosh on the six scene changes
    parts = ["[0:a]aresample=48000,aformat=channel_layouts=mono,asplit=2[vo][key]"]
    # whoosh: one copy per cut, centered slightly before the change
    parts.append("[1:a]aresample=48000,aformat=channel_layouts=mono,volume=0.45,asplit=%d%s" % (len(cuts), "".join("[w%d]" % i for i in range(len(cuts)))))
    for i, c in enumerate(cuts):
        parts.append("[w%d]adelay=%d:all=1[wd%d]" % (i, d(max(0.0, c - 0.25)), i))
    s1 = min(3.5, sec(b[0][1] - b[0][0]))
    parts.append("[2:a]aresample=48000,aformat=channel_layouts=mono,atrim=0:%.3f,afade=t=out:st=%.3f:d=0.4,volume=0.35[clk]" % (s1, max(0, s1 - 0.4)))
    s2 = min(4.0, sec(b[1][1] - b[1][0]))
    parts.append("[3:a]aresample=48000,aformat=channel_layouts=mono,aloop=loop=-1:size=2147483647,atrim=0:%.3f,afade=t=out:st=%.3f:d=0.4,volume=0.5,adelay=%d:all=1[hb]" % (s2, max(0, s2 - 0.4), d(sec(b[1][0]))))
    parts.append("[4:a]aresample=48000,aformat=channel_layouts=mono,volume=0.6,adelay=%d:all=1[ch]" % d(sec(b[5][0]) + 0.2))
    # music: loop once with a 1 s crossfade, fade out, ducked about 18 dB under the narration
    parts.append("[5:a]aresample=48000,aformat=channel_layouts=mono,asplit=2[m1][m2]")
    parts.append("[m1][m2]acrossfade=d=1[mloop]")
    parts.append("[mloop]atrim=0:%.3f,afade=t=out:st=%.3f:d=1.5,volume=0.3[mus]" % (total, max(0, total - 1.5)))
    parts.append("[mus][key]sidechaincompress=threshold=0.02:ratio=20:attack=20:release=350:makeup=1[duck]")
    inputs = "[vo]" + "".join("[wd%d]" % i for i in range(len(cuts))) + "[clk][hb][ch][duck]"
    n = 1 + len(cuts) + 4
    if norm is None:   # pass 1: measure only
        tail = "loudnorm=I=%.1f:TP=%.1f:LRA=11:print_format=json" % (TARGET_LUFS, TRUE_PEAK)
    else:              # pass 2: linear gain from the measurement, so the target is met exactly
        # Static gain to the target, then a brick-wall limiter keeps peaks under the true-peak ceiling.
        gain = float(norm["gain_db"])
        tail = "volume=%.2fdB,alimiter=limit=%.4f:attack=1:release=50:level=false,aresample=48000" % (gain, 10 ** (TRUE_PEAK / 20) * 0.94)
    parts.append("%samix=inputs=%d:normalize=0:duration=longest,apad,atrim=0:%.3f,%s[out]" % (inputs, n, total, tail))
    return ";".join(parts)


def _inputs(stage, video):
    a = video["audio"]
    keys = [a["vo"], a["whoosh"], a["clock"], a["heartbeat"], a["chime"], a["music"]]
    argv = []
    for k in keys:
        argv += ["-i", os.path.join(stage, k)]
    return argv


def measure(stage, video):
    argv = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats"] + _inputs(stage, video) + [
        "-filter_complex", filter_graph(video["timing"]["sceneFrames"]), "-map", "[out]", "-f", "null", "-"]
    err = subprocess.run(argv, capture_output=True, text=True, check=True).stderr
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])


def command(stage, video, out_wav, norm):
    return ["ffmpeg", "-nostdin", "-v", "error", "-n"] + _inputs(stage, video) + [
        "-filter_complex", filter_graph(video["timing"]["sceneFrames"], norm), "-map", "[out]", "-ac", "2", "-c:a", "pcm_s16le", out_wav]


def loudness(path):
    err = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", path, "-af",
                          "loudnorm=I=-14:TP=-1.5:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True).stderr
    m = json.loads(err[err.rindex("{"):err.rindex("}") + 1])
    return float(m["input_i"]), float(m["input_tp"])


def mix(stage, video, out_wav, tolerance=0.5):
    """The limiter lowers loudness a little, so the static gain is refined until -14 +/- 0.5 LUFS."""
    gain = TARGET_LUFS - float(measure(stage, video)["input_i"])
    tmp = out_wav + ".pass.wav"
    for _ in range(4):
        if os.path.exists(tmp):
            os.unlink(tmp)
        subprocess.run(command(stage, video, tmp, {"gain_db": gain}), check=True)
        lufs, tp = loudness(tmp)
        if abs(lufs - TARGET_LUFS) <= tolerance and tp <= TRUE_PEAK + 0.5:
            os.replace(tmp, out_wav)
            return {"integrated_lufs": lufs, "true_peak_db": tp, "gain_db": round(gain, 2)}
        gain += TARGET_LUFS - lufs
    raise RuntimeError("exam_audio_loudness_not_reached")


def main(request_path, stage, out_wav):
    req = json.load(open(request_path))
    validate_request(req)
    print(json.dumps(mix(stage, req["video"], out_wav)))


if __name__ == "__main__":
    main(*sys.argv[1:4])
