"""Policy tests use synthetic bytes only; no video generation in the sandbox."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from contract import BATCH_SIZE, MAX_ATTEMPTS, digest, validate_command, validate_recipe
from state import State
from storage import LocalArchive, safe_path
from client import signature


def recipe():
    files = [{"key": "audio", "bytes": 4, "sha256": hashlib.sha256(b"data").hexdigest()},
             {"key": "master", "bytes": 4, "sha256": hashlib.sha256(b"data").hexdigest()}]
    video = {"video_id": "lesson-en", "language": "en", "width": 1080, "height": 1920, "duration_ms": 10000,
             "scene": "approved-scene", "text": "Example", "subtitle": "Example", "cta": "Example", "audio": "audio", "master": "master",
             "timing": [{"start_ms": 0, "end_ms": 10000}]}
    return {"schema_version": 1, "recipe_id": "test-professional", "version": "v1", "renderer": "reviewed-renderer", "series": "professional",
            "languages": ["en"], "files": files, "videos": [video]}


def command(operation, payload):
    return {"schema_version": 1, "delivery_id": str(uuid.uuid4()), "operation": operation, "payload": payload}


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = State(Path(self.tmp.name) / "state.db")
        self.recipe = recipe()
        self.state.apply(command("register_recipe", self.recipe))

    def trial(self):
        return self.state.apply(command("trial", {"recipe_id": self.recipe["recipe_id"], "version": "v1"}))

    def test_default_batch_is_five(self):
        self.assertEqual(BATCH_SIZE, 5)

    def test_redelivery_creates_only_one_job(self):
        c = command("trial", {"recipe_id": self.recipe["recipe_id"], "version": "v1"})
        first = self.state.apply(c)
        self.assertEqual(first, self.state.apply(c))
        self.assertEqual(first, self.trial())
        with self.state.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM jobs").fetchone()[0], 1)

    def test_changed_delivery_identity_rejected(self):
        c = command("trial", {"recipe_id": self.recipe["recipe_id"], "version": "v1"})
        self.state.apply(c)
        c["operation"] = "status"
        c["payload"] = {"job_id": str(uuid.uuid4())}
        with self.assertRaisesRegex(ValueError, "delivery_identity_conflict"):
            self.state.apply(c)

    def test_one_video_lease_only(self):
        self.trial()
        self.assertIsNotNone(self.state.claim())
        self.assertIsNone(self.state.claim())

    def test_restart_recovers_expired_lease(self):
        self.trial()
        first = self.state.claim(now=100)
        recovered = State(self.state.path).claim(now=281)
        self.assertEqual(first["id"], recovered["id"])
        self.assertNotEqual(first["lease"], recovered["lease"])

    def test_owner_cannot_skip_verified_trial(self):
        approval = {"approval_id": str(uuid.uuid4()), "recipe_sha256": digest(self.recipe), "trial_receipt_sha256": "0" * 64,
                    "approved_at": int(time.time()), "owner_authorized": True}
        with self.assertRaisesRegex(ValueError, "verified_trial_approval_required"):
            self.state.apply(command("start_series", {"recipe_id": self.recipe["recipe_id"], "version": "v1", "approval": approval}))

    def test_expired_lease_cannot_commit_or_renew(self):
        self.trial()
        job = self.state.claim(now=100)
        self.assertFalse(self.state.heartbeat(job["id"], job["lease"]))
        with self.assertRaisesRegex(ValueError, "lease_lost"):
            self.state.finish_video(job, "test/v1/video", {})

    def test_repeated_crashes_stop_after_three_leases(self):
        self.trial()
        for now in (100, 281, 462):
            self.assertIsNotNone(self.state.claim(now=now))
        self.assertIsNone(self.state.claim(now=643))
        with self.state.transaction() as db:
            job = db.execute("SELECT status,attempts FROM jobs").fetchone()
            self.assertEqual((job["status"], job["attempts"]), ("failed", 3))

    def test_approval_is_bound_to_completed_trial(self):
        self.trial()
        job = self.state.claim()
        receipt = {"sha256": "1" * 64, "bytes": 1024, "object_key": "test-professional/v1/lesson-en"}
        self.state.finish_video(job, receipt["object_key"], receipt)
        approval = {"approval_id": str(uuid.uuid4()), "recipe_sha256": digest(self.recipe), "trial_receipt_sha256": digest(receipt),
                    "approved_at": int(time.time()), "owner_authorized": True}
        result = self.state.apply(command("start_series", {"recipe_id": self.recipe["recipe_id"], "version": "v1", "approval": approval}))
        self.assertEqual(result["status"], "queued")

    def test_pause_finishes_current_video_without_starting_next(self):
        second = copy.deepcopy(self.recipe["videos"][0])
        second["video_id"] = "lesson-en-2"
        self.recipe["videos"].append(second)
        self.recipe["version"] = "v2"
        self.state.apply(command("register_recipe", self.recipe))
        # Directly seed an approved series here to isolate the pause rule.
        jid = str(uuid.uuid4())
        with self.state.transaction() as db:
            db.execute("INSERT INTO jobs(id,recipe,version,mode,status) VALUES(?,?,?,?,?)", (jid, self.recipe["recipe_id"], "v2", "series", "queued"))
        job = self.state.claim()
        self.state.apply(command("pause", {"job_id": jid}))
        self.state.finish_video(job, "test-professional/v2/lesson-en", {"sha256": "2" * 64})
        self.assertIsNone(self.state.claim())
        self.state.apply(command("resume", {"job_id": jid}))
        self.assertEqual(self.state.claim()["cursor"], 1)

    def test_retries_are_bounded_at_three(self):
        jid = self.trial()["id"]
        for n in range(MAX_ATTEMPTS):
            self.state.fail(self.state.claim(), "test_failure")
            if n < MAX_ATTEMPTS - 1:
                self.state.apply(command("retry", {"job_id": jid}))
        with self.assertRaisesRegex(ValueError, "retry_not_allowed"):
            self.state.apply(command("retry", {"job_id": jid}))
        self.assertEqual(MAX_ATTEMPTS, 3)

    def test_recipe_version_cannot_change(self):
        altered = copy.deepcopy(self.recipe)
        altered["videos"][0]["cta"] = "Changed"
        with self.assertRaisesRegex(ValueError, "immutable_recipe_conflict"):
            self.state.apply(command("register_recipe", altered))

    def test_ielts_requires_exactly_27_languages(self):
        r = recipe()
        r["series"] = "ielts"
        with self.assertRaisesRegex(ValueError, "ielts_requires_27_languages"):
            validate_recipe(r)
        r["languages"] = ["lang-" + str(i) for i in range(27)]
        r["videos"] = [{**r["videos"][0], "video_id": "video-" + str(i), "language": language} for i, language in enumerate(r["languages"])]
        self.assertEqual(len(validate_recipe(r)["videos"]), 27)

    def test_cambridge_blocked_until_ielts_complete(self):
        r = recipe()
        r["series"] = "cambridge"
        r["recipe_id"] = "cambridge-test"
        self.state.apply(command("register_recipe", r))
        self.state.apply(command("trial", {"recipe_id": r["recipe_id"], "version": "v1"}))
        job = self.state.claim()
        receipt = {"sha256": "3" * 64}
        self.state.finish_video(job, "cambridge-test/v1/lesson-en", receipt)
        approval = {"approval_id": str(uuid.uuid4()), "recipe_sha256": digest(r), "trial_receipt_sha256": digest(receipt), "approved_at": int(time.time()), "owner_authorized": True}
        with self.assertRaisesRegex(ValueError, "ielts_first_required"):
            self.state.apply(command("start_series", {"recipe_id": r["recipe_id"], "version": "v1", "approval": approval}))

    def test_czech_trial_completes_only_one_video(self):
        r = recipe()
        r.update(series="ielts", recipe_id="ielts-cs-trial", languages=["cs"])
        r["videos"][0].update(language="cs", video_id="ielts-cs")
        self.state.apply(command("register_recipe", r))
        self.state.apply(command("trial", {"recipe_id": r["recipe_id"], "version": "v1"}))
        job = self.state.claim()
        self.state.finish_video(job, "ielts-cs-trial/v1/ielts-cs", {"sha256": "4" * 64})
        self.assertIsNone(self.state.claim())
        with self.state.transaction() as db:
            row = db.execute("SELECT cursor,status FROM jobs WHERE recipe='ielts-cs-trial'").fetchone()
            self.assertEqual((row["cursor"], row["status"]), (1, "completed"))

    def test_czech_recipe_rejects_series(self):
        r = recipe()
        r.update(series="ielts", recipe_id="ielts-cs-trial", languages=["cs"])
        r["videos"][0].update(language="cs", video_id="ielts-cs")
        self.state.apply(command("register_recipe", r))
        approval = {"approval_id": str(uuid.uuid4()), "recipe_sha256": digest(r),
                    "trial_receipt_sha256": "0" * 64, "approved_at": int(time.time()), "owner_authorized": True}
        with self.assertRaisesRegex(ValueError, "trial_only_recipe"):
            self.state.apply(command("start_series", {"recipe_id": r["recipe_id"], "version": "v1", "approval": approval}))

    def test_recipe_cannot_supply_code_or_secret(self):
        for field in ("shell", "install", "secret", "url"):
            r = recipe()
            r[field] = "private"
            with self.assertRaises(ValueError):
                validate_recipe(r)

    def test_no_delete_operation(self):
        with self.assertRaises(ValueError):
            validate_command(command("delete_archive", {}))

    def test_immutable_archive_readback(self):
        source = Path(self.tmp.name) / "synthetic-bytes"
        source.write_bytes(b"original")
        store = LocalArchive(Path(self.tmp.name) / "archive")
        receipt = store.save("test/v1/video", source, {"test_fixture": True})
        self.assertTrue(store.verify(receipt))
        source.write_bytes(b"replacement")
        with self.assertRaisesRegex(ValueError, "archive_conflict"):
            store.save("test/v1/video", source, {})
        with store.read("test/v1/video") as stream:
            self.assertEqual(stream.read(), b"original")

    def test_path_traversal_and_symlink_rejected(self):
        for key in ("../outside", "/absolute", "a/../b", "a//b", "a%2fb"):
            with self.assertRaises(ValueError):
                safe_path(self.tmp.name, key)
        (Path(self.tmp.name) / "link").symlink_to("/tmp")
        with self.assertRaisesRegex(ValueError, "symlink_not_allowed"):
            safe_path(self.tmp.name, "link/video")

    def test_signed_protocol_binds_method_path_nonce_body(self):
        secret = "synthetic-test-key-" * 3
        baseline = signature(secret, "100", "nonce", "POST", "/claim", b"a")
        for args in [("101", "nonce", "POST", "/claim", b"a"), ("100", "other", "POST", "/claim", b"a"), ("100", "nonce", "GET", "/claim", b"a"), ("100", "nonce", "POST", "/events", b"a"), ("100", "nonce", "POST", "/claim", b"b")]:
            self.assertNotEqual(baseline, signature(secret, *args))

    def test_outbox_survives_restart_and_only_ack_removes_pending(self):
        pending = self.state.pending()
        self.assertGreater(len(pending), 0)
        restarted = State(self.state.path)
        self.assertEqual(restarted.pending(), pending)
        restarted.acknowledge(pending[0]["event_id"])
        self.assertEqual(len(restarted.pending()), len(pending) - 1)


if __name__ == "__main__":
    unittest.main()