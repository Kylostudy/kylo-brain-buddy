"""Additive routing: new story trials never change pinned legacy validators."""
import uuid
import seven_stories as seven


def validate_recipe(raw):
    if seven.targeted(raw):
        return seven.validate(raw)
    from exam_sim_runtime import validate_recipe as legacy
    return legacy(raw)


def validate_command(raw):
    from contract import keys
    if isinstance(raw, dict) and isinstance(raw.get("payload"), dict):
        p, op = raw["payload"], raw.get("operation")
        if op == "register_recipe" and seven.targeted(p):
            keys(raw, {"schema_version", "delivery_id", "operation", "payload"}, {"schema_version", "delivery_id", "operation", "payload"})
            if type(raw["schema_version"]) is not int or raw["schema_version"] != 1 or str(uuid.UUID(raw["delivery_id"])) != raw["delivery_id"]:
                raise ValueError("seven_command_invalid")
            seven.validate(p)
            return raw
        if str(p.get("recipe_id", "")).startswith("seven-stories-"):
            if op == "start_series":
                raise ValueError("trial_only_recipe")
            if op == "trial" and (p.get("version") != "v1" or p.get("recipe_id") not in {seven.template(s)["recipe_id"] for s in seven.STORIES}):
                raise ValueError("seven_trial_invalid")
    from exam_sim_runtime import validate_command as legacy
    return legacy(raw)