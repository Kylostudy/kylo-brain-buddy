"""Goethe B2 profile ships as an additive v4 renderer: only examProfiles.ts differs from v3, legacy renderers stay usable."""
import unittest
from pathlib import Path
from contract import validate_recipe
from test_factory import recipe

R = Path(__file__).parent
PROFILES = (R / "exam-safe-v4-renderer/src/examProfiles.ts").read_text()


def goethe():
    r = recipe()
    r.update(series="other", recipe_id="goethe-b2-hu-trial", renderer="exam-promo-profiles-safe-v4", languages=["hu"])
    r["videos"] = [{**r["videos"][0], "video_id": "goethe-b2-hu", "language": "hu", "scene": "exam-promo-profiles-safe-v4"}]
    return r


class SafeV4(unittest.TestCase):
    def test_only_exam_profiles_differs_from_v3(self):
        for f in (R / "exam-safe-v3-renderer").rglob("*"):
            if f.is_file() and f.name != "SHA256SUMS":
                rel = f.relative_to(R / "exam-safe-v3-renderer")
                other = (R / "exam-safe-v4-renderer" / rel).read_bytes()
                if str(rel) == "src/examProfiles.ts":
                    self.assertNotEqual(f.read_bytes(), other)
                else:
                    self.assertEqual(f.read_bytes(), other)

    def test_goethe_profile_exact_fields(self):
        for snippet in (
            'id: "goethe-zertifikat-b2"',
            'name: "Goethe-Zertifikat B2"',
            'taskHeading: "SPRECHEN · ÜBUNGSBEISPIEL"',
            "timerSeconds: 900",
            '[["Lesen", "65"], ["Hören", "≈40"], ["Schreiben", "75"], ["Sprechen", "≈15 / pair"]]',
            'vocabulary: ["der Vorteil", "der Nachteil"]',
        ):
            self.assertIn(snippet, PROFILES)

    def test_resolver_accepts_only_other_series_with_goethe_id(self):
        self.assertIn('if (series === "other" && id === GOETHE_B2_PROFILE.id) return GOETHE_B2_PROFILE;', PROFILES)
        self.assertIn('throw new Error("unsupported_exam_profile")', PROFILES)
        self.assertIn('throw new Error("cambridge_profile_required")', PROFILES)

    def test_v4_has_own_scene_and_legacy_renderers_untouched(self):
        act = (R / "activate-manager.sh").read_text()
        self.assertIn('"exam-promo-profiles-safe-v4": ["exam-promo-profiles-safe-v4"]', act)
        self.assertIn('"exam-promo-profiles-safe-v3": ["exam-promo-profiles-safe-v3"]', act)
        self.assertIn('"exam-promo-profiles-safe-v2": ["exam-promo-profiles-safe-v2"]', act)
        prep = (R / "prepare-exam-safe-v4-renderer.sh").read_text()
        self.assertNotIn("safe-v3", prep)
        self.assertIn("immutable_renderer_conflict", prep)
        self.assertIn("fonts-noto", (R / "exam-safe-v4-renderer/Dockerfile").read_text())

    def test_contract_accepts_single_hungarian_goethe_trial(self):
        validated = validate_recipe(goethe())
        self.assertEqual(len(validated["videos"]), 1)
        self.assertEqual(validated["videos"][0]["language"], "hu")

    def test_contract_still_rejects_unknown_series(self):
        r = goethe()
        r["series"] = "goethe"
        with self.assertRaisesRegex(ValueError, "unsupported_series"):
            validate_recipe(r)


if __name__ == "__main__":
    unittest.main()
