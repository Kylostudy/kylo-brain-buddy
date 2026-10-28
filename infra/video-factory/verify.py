"""Media checks executed only on the VPS, never at package/test construction."""
import json
from pathlib import Path
import subprocess


def verify_video(path, video):
    if not Path(path).is_file() or Path(path).stat().st_size < 1024:
        raise ValueError("empty_video")
    result = subprocess.run(["/usr/bin/ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                            check=True, capture_output=True, timeout=30)
    data = json.loads(result.stdout)
    picture = [s for s in data["streams"] if s["codec_type"] == "video"]
    audio = [s for s in data["streams"] if s["codec_type"] == "audio"]
    if len(picture) != 1 or not audio:
        raise ValueError("video_and_audio_required")
    if (picture[0]["width"], picture[0]["height"]) != (video["width"], video["height"]):
        raise ValueError("dimensions_or_aspect_ratio_mismatch")
    duration = float(data["format"]["duration"])
    if video.get("universal") and picture[0].get("pix_fmt") != "yuv420p":
        raise ValueError("pixel_format_yuv420p_required")
    if abs(duration * 1000 - video["duration_ms"]) > 1000:
        raise ValueError("duration_mismatch")
    subprocess.run(["/usr/bin/ffmpeg", "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(path),
                    "-map", "0:v", "-map", "0:a", "-f", "null", "-"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=7200)
    return {"full_decode": True, "audio_present": True, "width": video["width"], "height": video["height"], "duration_ms": round(duration * 1000)}