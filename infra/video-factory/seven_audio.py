"""Measure full decoded native-rate audio, not MP3 container padding.

No trimming, resampling, tempo changes, output media or state writes.
The host preflight and pinned renderer overlay use the same implementation.
"""
import json
import math
import subprocess


def probe(path):
    data = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)
    ], timeout=30))
    streams = [s for s in data["streams"] if s["codec_type"] == "audio"]
    if len(streams) != 1:
        raise ValueError("seven_audio_duration")
    rate, channels = int(streams[0]["sample_rate"]), int(streams[0]["channels"])
    if rate <= 0 or channels <= 0:
        raise ValueError("seven_audio_duration")
    return {"sample_rate": rate, "channels": channels}


def decode(path, stream):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
        "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "s16le", "-"
    ], check=True, capture_output=True, timeout=120)
    frame_bytes = 2 * stream["channels"]
    if not result.stdout or len(result.stdout) % frame_bytes:
        raise ValueError("seven_audio_duration")
    return {**stream, "samples": len(result.stdout) // frame_bytes}


def validate_duration(measurement, expected_seconds, duration_ms):
    seconds = measurement["samples"] / measurement["sample_rate"]
    if (not math.isfinite(expected_seconds) or abs(seconds - expected_seconds) > .002
            or duration_ms < seconds * 1000 + 2000):
        raise ValueError("seven_audio_duration")
    return {**measurement, "decoded_duration_us": round(seconds * 1000000),
            "outro_hold_us": round(duration_ms * 1000 - seconds * 1000000)}


def verify(path, expected_seconds, duration_ms):
    return validate_duration(decode(path, probe(path)), expected_seconds, duration_ms)


if __name__ == "__main__":
    import sys
    path, expected, duration = sys.argv[1:]
    print(json.dumps(verify(path, float(expected), int(duration))))