"""Additive caption-only v2 contract; original v1 validator stays immutable."""
import seven_stories as seven

CONTRACT_ID = "kylo-seven-stories-hu-caption-v2"


def template(story):
    result = seven.template(story)
    result["version"] = "v2"
    return result


def targeted(raw):
    return seven.targeted(raw) and raw.get("version") == "v2"


def validate(raw):
    if not targeted(raw):
        raise ValueError("seven_caption_v2_required")
    original = dict(raw, version="v1")
    seven.validate(original)
    return raw


def validate_request(raw):
    if not isinstance(raw, dict) or set(raw) != {"manifest", "video"}:
        raise ValueError("seven_request_invalid")
    validate(raw["manifest"])
    if raw["video"] != raw["manifest"]["videos"][0]:
        raise ValueError("seven_request_video_mismatch")
    return raw


def contract_export():
    result = seven.contract_export()
    result.update(contract_id=CONTRACT_ID, versions=["v2"],
                  recipes=[template(s) for s in seven.STORIES],
                  caption_display={"exact_inputs": ["Kylo pont study.", "Kylo pont study"],
                                   "output": "kylo.study"},
                  archive_policy={"new_version_only": True, "overwrite": False})
    return result