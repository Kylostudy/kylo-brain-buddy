"""Owner policy: a continuation may only manufacture the 11 missing languages."""
import hashlib
import unittest
from contract import CONTINUATION_LANGUAGES, IELTS_LANGUAGES, validate_recipe


def continuation_recipe(languages, completed_languages):
    files = [{"key": "audio", "bytes": 4, "sha256": hashlib.sha256(b"data").hexdigest()},
             {"key": "master", "bytes": 4, "sha256": hashlib.sha256(b"data").hexdigest()}]
    videos = [{"video_id": "lesson-" + lang, "language": lang, "width": 1080, "height": 1920, "duration_ms": 10000,
               "scene": "approved-scene", "text": "Example", "subtitle": "Example", "cta": "Example",
               "audio": "audio", "master": "master", "timing": [{"start_ms": 0, "end_ms": 10000}]}
              for lang in languages]
    receipt = {"storage_type": "local", "object_key": "ielts-cs-trial/v1/ielts-cs",
               "bytes": 5801362, "sha256": hashlib.sha256(b"receipt").hexdigest()}
    return {"schema_version": 1, "recipe_id": "ielts-continuation", "version": "v1", "renderer": "reviewed-renderer",
            "series": "ielts", "languages": languages, "files": files, "videos": videos,
            "continuation": {"trial_recipe_id": "ielts-cs-trial", "trial_version": "v1",
                             "completed": [{"language": lang, "receipt": receipt} for lang in completed_languages]}}


DONE = sorted(IELTS_LANGUAGES - CONTINUATION_LANGUAGES)


class ContinuationPolicyTests(unittest.TestCase):
    def test_exactly_the_11_missing_languages_accepted(self):
        validate_recipe(continuation_recipe(sorted(CONTINUATION_LANGUAGES), DONE))

    def test_completed_language_may_not_be_manufactured(self):
        languages = sorted(CONTINUATION_LANGUAGES - {"ar"} | {"en"})
        with self.assertRaisesRegex(ValueError, "continuation_languages_restricted"):
            validate_recipe(continuation_recipe(languages, DONE))

    def test_extra_unknown_language_rejected(self):
        with self.assertRaisesRegex(ValueError, "continuation_languages_restricted"):
            validate_recipe(continuation_recipe(sorted(CONTINUATION_LANGUAGES | {"xx"}), DONE))

    def test_missing_language_subset_rejected(self):
        with self.assertRaisesRegex(ValueError, "continuation_must_cover_27_without_repeats"):
            validate_recipe(continuation_recipe(sorted(CONTINUATION_LANGUAGES - {"ja"}), DONE))

    def test_documented_seven_language_continuation(self):
        r = continuation_recipe(["da", "sv", "tr", "sk", "sl", "sr", "ru"], DONE)
        r["continuation"]["blocked_languages"] = [{"language": l, "reason": "font_pending"} for l in ["ja", "ko", "ar", "hi"]]
        self.assertEqual(validate_recipe(r)["languages"], ["da", "sv", "tr", "sk", "sl", "sr", "ru"])

    def test_missing_block_reason_rejected(self):
        r = continuation_recipe(sorted(CONTINUATION_LANGUAGES - {"ja"}), DONE)
        r["continuation"]["blocked_languages"] = [{"language": "ja", "reason": " "}]
        with self.assertRaisesRegex(ValueError, "blocked_language_reason_required"):
            validate_recipe(r)

    def test_blocked_language_cannot_be_rendered(self):
        r = continuation_recipe(sorted(CONTINUATION_LANGUAGES), DONE)
        r["continuation"]["blocked_languages"] = [{"language": "ja", "reason": "font_pending"}]
        with self.assertRaisesRegex(ValueError, "continuation_languages_restricted"):
            validate_recipe(r)


if __name__ == "__main__":
    unittest.main()
