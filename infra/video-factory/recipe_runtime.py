"""Additive routing: new story trials never change pinned legacy validators."""
import uuid
import seven_stories as seven
import seven_caption_v2 as caption_v2
import seven_series as series


def validate_recipe(raw):
    if series.targeted(raw):
        return series.validate(raw)
    if caption_v2.targeted(raw):
        return caption_v2.validate(raw)
    if seven.targeted(raw):
        return seven.validate(raw)
    from exam_sim_runtime import validate_recipe as legacy
    return legacy(raw)


def validate_command(raw):
    from contract import keys
    if isinstance(raw, dict) and (series.targeted(raw.get("payload")) or raw.get("operation") == "self_check"):
        return series.validate_command(raw)
    if isinstance(raw, dict) and isinstance(raw.get("payload"), dict):
        p, op = raw["payload"], raw.get("operation")
        if op == "register_recipe" and seven.targeted(p):
            keys(raw, {"schema_version", "delivery_id", "operation", "payload"}, {"schema_version", "delivery_id", "operation", "payload"})
            if type(raw["schema_version"]) is not int or raw["schema_version"] != 1 or str(uuid.UUID(raw["delivery_id"])) != raw["delivery_id"]:
                raise ValueError("seven_command_invalid")
            validate_recipe(p)
            return raw
        if str(p.get("recipe_id", "")).startswith("seven-stories-"):
            if op == "start_series":
                raise ValueError("trial_only_recipe")
            if op == "trial" and (p.get("version") not in {"v1", "v2"} or p.get("recipe_id") not in {seven.template(s)["recipe_id"] for s in seven.STORIES}):
                raise ValueError("seven_trial_invalid")
    from exam_sim_runtime import validate_command as legacy
    return legacy(raw)