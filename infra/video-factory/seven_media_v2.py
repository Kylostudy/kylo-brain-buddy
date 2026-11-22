"""Caption-v2 readback; reuse every immutable v1 media/layout acceptance rule."""
import copy
import json

import seven_media as v1
import seven_stories as seven


def projected_video(video):
    story = video.get("story") if isinstance(video, dict) else None
    if story not in seven.STORIES or video != seven.template(story)["videos"][0]:
        raise ValueError("seven_request_video_mismatch")
    projected = copy.deepcopy(video)
    for subtitle in projected["timeline"]["subtitles"]:
        if subtitle["text"] in ("Kylo pont study.", "Kylo pont study"):
            subtitle["text"] = "kylo.study"
    return projected


def verify_layout(path, video):
    return v1.verify_layout(path, projected_video(video))


def verify(output, audio, layout, video):
    return v1.verify(output, audio, layout, projected_video(video))


if __name__ == "__main__":
    import sys
    output, audio, layout, story = sys.argv[1:]
    print(json.dumps(verify(output, audio, layout, seven.template(story)["videos"][0])))