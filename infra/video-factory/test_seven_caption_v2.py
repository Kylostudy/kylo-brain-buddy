import copy
import json
from pathlib import Path
import tempfile
import unittest

import seven_stories as v1
import seven_caption_v2 as v2
from seven_audio_runtime import audio_mounts, REVIEWED_IMAGE
from recipe_runtime import validate_command, validate_recipe
from state import State
from test_seven_stories import command

HERE = Path(__file__).parent


class CaptionV2Tests(unittest.TestCase):
    def test_all_seven_v2_trials_change_only_recipe_version(self):
        for story in v1.STORIES:
            old, new = v1.template(story), v2.template(story)
            self.assertEqual(validate_recipe(new), new)
            self.assertEqual(new["version"], "v2")
            self.assertEqual(dict(new, version="v1"), old)
            self.assertEqual(validate_recipe(old), old)

    def test_audio_and_alignment_unchanged(self):
        for story in v1.STORIES:
            new = v2.template(story)
            self.assertEqual(new["files"], v1.template(story)["files"])
            for i in (0, 1):
                changed = copy.deepcopy(new)
                changed["files"][i]["sha256"] = "0" * 64
                with self.assertRaises(ValueError):
                    validate_recipe(changed)

    def test_scene_frames_unchanged(self):
        new = v2.template("hajo")
        new["videos"][0]["timeline"]["sceneFrames"][0] += 1
        with self.assertRaises(ValueError):
            validate_recipe(new)

    def test_hungarian_only(self):
        new = v2.template("hajo"); new["languages"] = ["en"]
        with self.assertRaises(ValueError): validate_recipe(new)

    def test_no_series(self):
        with self.assertRaisesRegex(ValueError, "trial_only_recipe"):
            validate_command(command("start_series", {"recipe_id": v2.template("hajo")["recipe_id"], "version": "v2"}))

    def test_v1_and_v2_jobs_remain_separate_and_idempotent(self):
        with tempfile.TemporaryDirectory() as root:
            state = State(Path(root) / "state.db")
            ids = []
            for version in ("v1", "v2"):
                recipe = v1.template("hajo") if version == "v1" else v2.template("hajo")
                state.apply(command("register_recipe", recipe))
                payload = {"recipe_id": recipe["recipe_id"], "version": version}
                job = state.apply(command("trial", payload))
                self.assertEqual(job["id"], state.apply(command("trial", payload))["id"])
                ids.append(job["id"])
            self.assertNotEqual(*ids)
            with state.transaction() as db:
                self.assertEqual(db.execute("select count(*) from jobs").fetchone()[0], 2)

    def test_caption_overlays_only_for_v2_and_exact_pinned_image(self):
        renderer = {"image": REVIEWED_IMAGE, "reviewed": True, "scenes": v1.SCENES}
        for story in v1.STORIES:
            old = audio_mounts(v1.template(story), renderer)
            new = audio_mounts(v2.template(story), renderer)
            self.assertEqual(len(old), 4)
            self.assertEqual(len(new), 8)
            self.assertTrue(all(m.endswith(":ro") for m in new[1::2]))
            self.assertEqual(len(set(m.split(":")[-2] for m in new[1::2])), 4)
        renderer["image"] = "sha256:" + "0" * 64
        with self.assertRaises(ValueError): audio_mounts(v2.template("hajo"), renderer)

    def test_unapproved_version_rejected(self):
        recipe = v2.template("hajo"); recipe["version"] = "v3"
        with self.assertRaises(ValueError): validate_recipe(recipe)

    def test_missing_caption_overlay_blocks_v2(self):
        renderer = {"image": REVIEWED_IMAGE, "reviewed": True, "scenes": v1.SCENES}
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError): audio_mounts(v2.template("hajo"), renderer, root)

    def test_registered_preflight_uses_v2_paths_not_v1(self):
        from seven_preflight import run
        from unittest.mock import patch
        paths = []
        with tempfile.TemporaryDirectory() as root, patch("seven_preflight.checked_file", side_effect=lambda p, d: paths.append(p) or False):
            report = run(root, registered=True, version="v2")
        self.assertEqual(len(paths), 21)
        self.assertTrue(all("v2" in p.parts and "v1" not in p.parts for p in paths))
        self.assertEqual(report["contract_id"], "kylo-seven-stories-hu-caption-v2")
        self.assertFalse(report["preparation_ok"])


if __name__ == "__main__": unittest.main()