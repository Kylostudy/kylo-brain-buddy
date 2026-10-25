"""Recipe font and durable rejection rules; synthetic bytes only, no video render."""
from pathlib import Path
import tempfile
import unittest
from test_factory import recipe, command
from contract import validate_recipe
from state import State


class FontTests(unittest.TestCase):
    def test_legacy_recipe_without_font_still_valid(self):
        self.assertEqual(validate_recipe(recipe())["videos"][0]["language"], "en")

    def test_declared_font_is_accepted(self):
        r = recipe()
        r["files"].append({**r["files"][0], "key": "fonts/notosans-jp-ttf"})
        r["videos"][0]["font"] = "fonts/notosans-jp-ttf"
        self.assertEqual(validate_recipe(r)["videos"][0]["font"], "fonts/notosans-jp-ttf")

    def test_unverified_font_is_rejected(self):
        r = recipe()
        r["videos"][0]["font"] = "fonts/missing"
        with self.assertRaisesRegex(ValueError, "missing_font_reference"):
            validate_recipe(r)

    def test_remote_font_url_is_rejected(self):
        r = recipe()
        r["videos"][0]["font"] = "https://example.com/font.ttf"
        with self.assertRaisesRegex(ValueError, "invalid_object_key"):
            validate_recipe(r)

    def test_rejection_survives_restart_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "state.db"
            s = State(path)
            c = command("register_recipe", recipe())
            s.reject(c, "continuation_languages_restricted")
            restarted = State(path)
            restarted.reject(c, "continuation_languages_restricted")
            events = restarted.pending()
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["entity_id"], c["delivery_id"])
            self.assertEqual(events[0]["result"], {"ok": False, "error": "continuation_languages_restricted"})
            self.assertEqual(restarted.apply(c), events[0]["result"])


if __name__ == "__main__":
    unittest.main()