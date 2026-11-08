"""Inert policy tests for the multilingual piggy-bank contract; never render or call providers."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from contract import validate_command, validate_recipe
import piggy_i18n
from piggy_i18n import (CONTINUATION_RECIPE, HU_V4_SHA256, LANGUAGES, RENDERER, SCENE,
                        TRANSLATIONS, TRIAL_LANGUAGE, TRIAL_RECIPE, audio_key, master_key)
from state import State
from test_factory import command

TIMING = [{"start_ms": a, "end_ms": b} for a, b in zip(
    [0, 4000, 14000, 18000, 28000, 33000, 36000], [4000, 14000, 18000, 28000, 33000, 36000, 39000])]
SHA = hashlib.sha256(b"data").hexdigest()


def video(language):
    fixed = TRANSLATIONS[language]
    text = {"heading": "Heading %s" % language, "disclaimer": fixed["disclaimer"], "truth": fixed["truth"],
            "price": fixed["price"], "unit": fixed["unit"], "steps": ["A", "B", "C", "D"],
            "counter_values": [20, 35, 55, 80, 105], "labels": ["a", "b", "c", "d", "e"],
            "outro_url": "kylo.study", "outro_tagline": "Your AI tutor"}
    return {"video_id": "malacpersely-%s" % language, "language": language, "width": 1080, "height": 1920,
            "duration_ms": 39000, "scene": SCENE, "text": json.dumps(text, ensure_ascii=False),
            "subtitle": json.dumps({"subs": [{"start_ms": 0, "end_ms": 3000, "text": "Felirat %s" % language}]}, ensure_ascii=False),
            "cta": json.dumps({"text": fixed["cta"], "supporting_text": fixed["supporting"], "trial_days": 14}, ensure_ascii=False),
            "audio": audio_key(language), "master": master_key(language), "timing": copy.deepcopy(TIMING)}


def files(languages):
    keys = [audio_key(lang) for lang in languages] + [master_key(lang) for lang in languages] + [piggy_i18n.COINS_KEY]
    return [{"key": k, "bytes": 4, "sha256": SHA} for k in keys]


def trial_recipe():
    return {"schema_version": 1, "recipe_id": TRIAL_RECIPE, "version": "v1", "renderer": RENDERER,
            "series": "other", "languages": [TRIAL_LANGUAGE], "videos": [video(TRIAL_LANGUAGE)],
            "files": files([TRIAL_LANGUAGE])}


def receipt(sha256=HU_V4_SHA256):
    return {"storage_type": "local", "bytes": 4, "sha256": sha256,
            "object_key": "malacpersely-hu-trial/v4/malacpersely-hu"}


def continuation_recipe():
    languages = sorted(LANGUAGES - {TRIAL_LANGUAGE})
    return {"schema_version": 1, "recipe_id": CONTINUATION_RECIPE, "version": "v1", "renderer": RENDERER,
            "series": "other", "languages": languages, "videos": [video(lang) for lang in languages],
            "files": files(languages),
            "continuation": {"trial_recipe_id": TRIAL_RECIPE, "trial_version": "v1",
                             "completed": [{"language": "hu", "receipt": receipt()},
                                           {"language": TRIAL_LANGUAGE, "receipt": receipt(hashlib.sha256(b"en").hexdigest())}]}}


class PiggyI18nTests(unittest.TestCase):
    def test_en_trial_accepted(self):
        r = trial_recipe()
        self.assertEqual(validate_recipe(r), r)

    def test_continuation_accepted(self):
        r = continuation_recipe()
        self.assertEqual(validate_recipe(r), r)

    def test_continuation_v2_accepted(self):
        # Additive: v2 carries the full preserved trial receipts; v1 stays valid.
        r = continuation_recipe()
        r["version"] = "v2"
        self.assertEqual(validate_recipe(r), r)

    def test_continuation_v3_rejected(self):
        r = continuation_recipe()
        r["version"] = "v3"
        with self.assertRaisesRegex(ValueError, "piggy_i18n_continuation_languages"):
            validate_recipe(r)

    def test_en_trial_v2_rejected(self):
        # The single English trial remains v1-only.
        r = trial_recipe()
        r["version"] = "v2"
        with self.assertRaisesRegex(ValueError, "piggy_i18n_single_en_trial_only"):
            validate_recipe(r)

    def test_continuation_v2_trial_anchor_stays_v1(self):
        # The continuation still anchors to the v1 English trial, even at v2.
        r = continuation_recipe()
        r["version"] = "v2"
        r["continuation"]["trial_version"] = "v2"
        with self.assertRaisesRegex(ValueError, "piggy_i18n_continuation_anchor"):
            validate_recipe(r)

    def test_all_26_languages_have_approved_translations(self):
        self.assertEqual(set(TRANSLATIONS), LANGUAGES)
        self.assertEqual(len(LANGUAGES), 26)
        for fixed in TRANSLATIONS.values():
            self.assertNotIn(fixed["disclaimer"], piggy_i18n.HU_STRINGS)
            self.assertEqual(len(fixed), 6)

    def test_hungarian_language_rejected(self):
        r = trial_recipe()
        r["languages"] = ["hu"]
        r["videos"][0]["language"] = "hu"
        with self.assertRaisesRegex(ValueError, "piggy_i18n"):
            validate_recipe(r)

    def test_hungarian_fixed_strings_rejected_in_subtitle(self):
        r = trial_recipe()
        r["videos"][0]["subtitle"] = json.dumps({"subs": [{"start_ms": 0, "end_ms": 3000, "text": "Több mint 100 USD/hó"}]})
        with self.assertRaisesRegex(ValueError, "piggy_i18n_hungarian_text"):
            validate_recipe(r)

    def test_translation_pinned(self):
        r = trial_recipe()
        text = json.loads(r["videos"][0]["text"])
        text["price"] = "19.99 USD/mo."
        r["videos"][0]["text"] = json.dumps(text)
        with self.assertRaisesRegex(ValueError, "piggy_i18n_translation_required"):
            validate_recipe(r)

    def test_counter_and_trial_days_pinned(self):
        r = trial_recipe()
        text = json.loads(r["videos"][0]["text"])
        text["counter_values"][-1] = 100
        r["videos"][0]["text"] = json.dumps(text)
        with self.assertRaisesRegex(ValueError, "piggy_invalid_offer"):
            validate_recipe(r)
        r = trial_recipe()
        r["videos"][0]["cta"] = json.dumps({"text": TRANSLATIONS["en"]["cta"], "supporting_text": TRANSLATIONS["en"]["supporting"], "trial_days": 7})
        with self.assertRaisesRegex(ValueError, "piggy_i18n_invalid_cta"):
            validate_recipe(r)

    def test_brand_immutable(self):
        r = trial_recipe()
        text = json.loads(r["videos"][0]["text"])
        text["outro_url"] = "kylo.example"
        r["videos"][0]["text"] = json.dumps(text)
        with self.assertRaisesRegex(ValueError, "piggy_i18n_brand_immutable"):
            validate_recipe(r)

    def test_coin_track_required_separately(self):
        r = trial_recipe()
        r["files"] = [f for f in r["files"] if f["key"] != piggy_i18n.COINS_KEY]
        with self.assertRaisesRegex(ValueError, "piggy_i18n_invalid_input_list"):
            validate_recipe(r)

    def test_unknown_file_rejected(self):
        r = trial_recipe()
        r["files"].append({"key": "audio/extra-mp3", "bytes": 4, "sha256": SHA})
        with self.assertRaisesRegex(ValueError, "piggy_i18n_invalid_input_list"):
            validate_recipe(r)

    def test_rtl_arabic_accepted_with_pinned_strings(self):
        r = continuation_recipe()
        self.assertEqual(validate_recipe(r), r)
        ar = [v for v in r["videos"] if v["language"] == "ar"][0]
        self.assertEqual(json.loads(ar["text"])["unit"], TRANSLATIONS["ar"]["unit"])

    def test_continuation_requires_hu_v4_receipt(self):
        r = continuation_recipe()
        r["continuation"]["completed"][0]["receipt"] = receipt(hashlib.sha256(b"wrong").hexdigest())
        with self.assertRaisesRegex(ValueError, "piggy_i18n_hu_reference_receipt"):
            validate_recipe(r)

    def test_continuation_requires_en_trial_receipt(self):
        r = continuation_recipe()
        r["continuation"]["completed"] = [r["continuation"]["completed"][0]]
        with self.assertRaisesRegex(ValueError, "piggy_i18n_continuation_anchor"):
            validate_recipe(r)

    def test_continuation_blocked_languages_rejected(self):
        r = continuation_recipe()
        r["continuation"]["blocked_languages"] = [{"language": "de", "reason": "x"}]
        with self.assertRaisesRegex(ValueError, "piggy_i18n_blocked_languages|invalid_blocked_languages"):
            validate_recipe(r)

    def test_continuation_exact_25_languages(self):
        r = continuation_recipe()
        r["languages"] = sorted(LANGUAGES)
        with self.assertRaisesRegex(ValueError, "piggy_i18n_continuation_languages"):
            validate_recipe(r)

    def test_continuation_missing_video_rejected(self):
        r = continuation_recipe()
        r["videos"] = r["videos"][1:]
        with self.assertRaisesRegex(ValueError, "piggy_i18n"):
            validate_recipe(r)

    def test_trial_multiple_languages_rejected(self):
        r = trial_recipe()
        r["languages"] = ["en", "de"]
        with self.assertRaisesRegex(ValueError, "piggy_i18n_single_en_trial_only"):
            validate_recipe(r)

    def test_old_hu_recipe_not_captured(self):
        self.assertFalse(piggy_i18n.targeted({"recipe_id": "malacpersely-hu-trial", "renderer": "piggy-bank-layout-safe-v2",
                                              "videos": [{"scene": "piggy-bank-v1"}]}))

    def test_series_command_rejected_for_en_trial(self):
        c = command("start_series", {"recipe_id": TRIAL_RECIPE, "version": "v1", "approval": {}})
        with self.assertRaisesRegex(ValueError, "trial_only_recipe"):
            validate_command(c)

    def test_version_two_series_rejected_for_en_trial(self):
        c = command("series_run", {"recipe_id": TRIAL_RECIPE, "version": "v1", "approval": {}})
        c["schema_version"] = 2
        from universal import FactoryError
        with self.assertRaises(FactoryError) as caught:
            validate_command(c)
        self.assertEqual(caught.exception.result["code"], "trial_only_recipe")

    def test_trial_queue_only(self):
        with tempfile.TemporaryDirectory() as temp:
            state = State(Path(temp) / "state.sqlite3")
            state.apply(command("register_recipe", trial_recipe()))
            result = state.apply(command("trial", {"recipe_id": TRIAL_RECIPE, "version": "v1"}))
            self.assertEqual(result["status"], "queued")

    def test_state_series_rejected_for_en_trial(self):
        with tempfile.TemporaryDirectory() as temp:
            state = State(Path(temp) / "state.sqlite3")
            state.apply(command("register_recipe", trial_recipe()))
            with self.assertRaisesRegex(ValueError, "trial_only_recipe"):
                state.apply(command("start_series", {"recipe_id": TRIAL_RECIPE, "version": "v1",
                                                     "approval": {"approval_id": "00000000-0000-0000-0000-000000000000",
                                                                  "recipe_sha256": SHA, "trial_receipt_sha256": SHA,
                                                                  "approved_at": 1, "owner_authorized": True}}))

    def test_subtitle_must_end_before_black_outro(self):
        r = trial_recipe()
        r["videos"][0]["subtitle"] = json.dumps({"subs": [{"start_ms": 35000, "end_ms": 37000, "text": "Late"}]})
        with self.assertRaisesRegex(ValueError, "piggy_invalid_subtitles"):
            validate_recipe(r)


if __name__ == "__main__":
    unittest.main()
