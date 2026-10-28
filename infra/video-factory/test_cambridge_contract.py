"""Cambridge continuation may only bind to the approved HU v2 trial and must render exactly the 26 other languages."""
import copy
import unittest
from contract import (CAMBRIDGE_HU_V2_BYTES, CAMBRIDGE_HU_V2_KEY, CAMBRIDGE_HU_V2_SHA, IELTS_LANGUAGES, validate_recipe)
from test_factory import recipe


def cambridge():
    r = recipe()
    langs = sorted(IELTS_LANGUAGES - {"hu"})
    r.update(series="cambridge", recipe_id="cambridge-b2-first-series", renderer="exam-promo-profiles-safe-v2", languages=langs)
    r["videos"] = [{**r["videos"][0], "video_id": "cambridge-" + l, "language": l} for l in langs]
    r["continuation"] = {"trial_recipe_id": "cambridge-b2-first-hu-trial", "trial_version": "v2", "completed": [
        {"language": "hu", "receipt": {"storage_type": "local", "object_key": CAMBRIDGE_HU_V2_KEY,
                                        "sha256": CAMBRIDGE_HU_V2_SHA, "bytes": CAMBRIDGE_HU_V2_BYTES}}]}
    return r


class CambridgeContractTests(unittest.TestCase):
    def test_approved_hu_v2_permits_exactly_26_languages(self):
        self.assertEqual(len(validate_recipe(cambridge())["videos"]), 26)

    def test_hungarian_cannot_be_rendered_again(self):
        r = cambridge()
        r["languages"].append("hu")
        with self.assertRaisesRegex(ValueError, "continuation_must_cover_27_without_repeats"):
            validate_recipe(r)

    def test_other_receipt_is_rejected(self):
        r = cambridge()
        r["continuation"]["completed"][0]["receipt"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "invalid_cambridge_trial_receipt"):
            validate_recipe(r)

    def test_other_renderer_is_rejected(self):
        r = cambridge()
        r["renderer"] = "exam-promo-profiles-v1"
        with self.assertRaisesRegex(ValueError, "invalid_cambridge_continuation"):
            validate_recipe(r)

    def test_missing_language_video_is_rejected(self):
        r = cambridge()
        r["videos"].pop()
        with self.assertRaises(ValueError):
            validate_recipe(r)


if __name__ == "__main__":
    unittest.main()
