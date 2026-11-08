"""Inert regression tests for the deployed v1-image/v2-recipe mismatch."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from piggy_v2_runtime import REVIEWED_IMAGE, validator_mounts
from test_factory import command
from test_piggy_i18n import continuation_recipe, trial_recipe
from state import State

RENDERER = {"reviewed": True, "scenes": ["piggy-bank-i18n-v1"], "image": REVIEWED_IMAGE}


class PiggyV2RuntimeTests(unittest.TestCase):
    def manifest(self):
        r = continuation_recipe()
        r["version"] = "v2"
        return r

    def test_v2_mounts_exact_reviewed_validator_read_only(self):
        mounts = validator_mounts(self.manifest(), RENDERER)
        self.assertEqual(mounts, ["-v", str(Path(__file__).parent.resolve() / "piggy_i18n.py")
                                + ":/app/validation/piggy_i18n.py:ro"])

    def test_v1_and_english_trial_receive_no_overlay(self):
        for manifest in (continuation_recipe(), trial_recipe()):
            with self.subTest(recipe=manifest["recipe_id"]):
                self.assertEqual(validator_mounts(manifest, RENDERER), [])

    def test_other_renderers_receive_no_overlay(self):
        r = self.manifest()
        r["renderer"] = "piggy-bank-layout-safe-v2"
        self.assertEqual(validator_mounts(r, RENDERER), [])

    def test_modified_validator_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "piggy_i18n.py"
            p.write_text("# not reviewed\n")
            with self.assertRaisesRegex(ValueError, "piggy_v2_validator_checksum_failed"):
                validator_mounts(self.manifest(), RENDERER, p)

    def test_symlink_validator_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "piggy_i18n.py"
            p.symlink_to(Path(__file__).parent.resolve() / "piggy_i18n.py")
            with self.assertRaisesRegex(ValueError, "piggy_v2_validator_checksum_failed"):
                validator_mounts(self.manifest(), RENDERER, p)

    def test_unreviewed_renderer_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "piggy_v2_validator_review_required"):
            validator_mounts(self.manifest(), {**RENDERER, "reviewed": False})

    def test_different_image_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "piggy_v2_validator_review_required"):
            validator_mounts(self.manifest(), {**RENDERER, "image": "sha256:" + "0" * 64})

    def test_v1_only_image_rejection_is_corrected_by_the_single_overlay(self):
        with tempfile.TemporaryDirectory() as d:
            validation = Path(d) / "validation"
            shutil.copytree(Path(__file__).parent / "piggy-multilang-renderer/validation", validation,
                            ignore=shutil.ignore_patterns("__pycache__"))
            pinned = validation / "piggy_i18n.py"
            text = pinned.read_text()
            pinned.write_text(text.replace('raw.get("version") not in CONTINUATION_VERSIONS',
                                           'raw.get("version") != VERSION'))
            run = [sys.executable, "-B", "-c",
                   'import json,sys;sys.path.insert(0,sys.argv[1]);from contract import validate_recipe;'
                   'validate_recipe(json.load(sys.stdin))', str(validation)]
            before = subprocess.run(run, input=json.dumps(self.manifest()), capture_output=True, text=True)
            self.assertNotEqual(before.returncode, 0)
            self.assertIn("piggy_i18n_continuation_languages", before.stderr)
            mounts = validator_mounts(self.manifest(), RENDERER)
            source = mounts[1].split(":", 1)[0]
            shutil.copyfile(source, pinned)
            after = subprocess.run(run, input=json.dumps(self.manifest()), capture_output=True, text=True)
            self.assertEqual(after.returncode, 0, after.stderr)

    def test_renderer_python_entrypoint_accepts_v2_rejects_v3_and_en_v2(self):
        # An isolated interpreter simulates the exact imported validator path;
        # no Docker/Chromium, media, providers or rendering.
        validation = Path(__file__).parent / "piggy-multilang-renderer/validation"
        for version, expected in (("v2", 0), ("v3", 1)):
            r = self.manifest()
            r["version"] = version
            p = subprocess.run([sys.executable, "-c",
                'import json,sys;sys.path.insert(0,sys.argv[1]);from contract import validate_recipe;'
                'validate_recipe(json.load(sys.stdin))', str(validation)],
                input=json.dumps(r), capture_output=True, text=True)
            self.assertEqual(p.returncode, expected, p.stderr)
        r = trial_recipe()
        r["version"] = "v2"
        p = subprocess.run([sys.executable, "-c",
            'import json,sys;sys.path.insert(0,sys.argv[1]);from contract import validate_recipe;'
            'validate_recipe(json.load(sys.stdin))', str(validation)],
            input=json.dumps(r), capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("piggy_i18n_single_en_trial_only", p.stderr)

    def test_retry_preserves_job_recipe_cursor_and_completed_receipts(self):
        with tempfile.TemporaryDirectory() as d:
            s = State(Path(d) / "state.sqlite3")
            r = self.manifest()
            s.apply(command("register_recipe", r))
            jid = "3b3a9d9a-4b57-4b64-af8e-e73e227e3426"
            receipt = {"sha256": "1" * 64, "bytes": 4, "object_key": "example"}
            with s.transaction() as db:
                db.execute("INSERT INTO jobs(id,recipe,version,mode,status,attempts,cursor) VALUES(?,?,?,?,?,?,?)",
                           (jid, r["recipe_id"], "v2", "series", "failed", 1, 1))
                db.execute("INSERT INTO outputs VALUES(?,?)", ("existing", json.dumps(receipt)))
                before = tuple(db.execute("SELECT hash,manifest FROM recipes").fetchone())
            c = command("retry", {"job_id": jid})
            first = s.apply(c)
            self.assertEqual(first, s.apply(c))
            self.assertEqual(first, {"id": jid, "status": "queued", "cursor": 1, "attempts": 1})
            with s.transaction() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM jobs").fetchone()[0], 1)
                self.assertEqual(tuple(db.execute("SELECT hash,manifest FROM recipes").fetchone()), before)
                self.assertEqual(json.loads(db.execute("SELECT receipt FROM outputs").fetchone()[0]), receipt)