"""Telemetry tests use local synthetic jobs, never a real renderer or credentials."""
import contextlib
import io
import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import failure_report
import monitoring
from agent import Runner, render_process
from contract import digest
from state import State
from test_factory import command, recipe


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = State(self.root / "state.db")
        self.client = MagicMock()
        self.client.request.side_effect = lambda op, body: {"acknowledged_event_id": body.get("event_id")}
        self.transport = monitoring.Transport(self.state, self.client, "factory-test", True)
        self.addCleanup(self.transport.close)

    def events(self):
        with self.state.transaction() as db:
            return [json.loads(r["body"]) for r in db.execute("SELECT body FROM monitor_outbox ORDER BY rowid")]

    def job(self):
        manifest = recipe()
        self.state.apply(command("register_recipe", manifest))
        self.state.apply(command("trial", {"recipe_id": manifest["recipe_id"], "version": "v1"}))
        job = self.state.claim()
        # Additive monitor routing is isolated from contract tests; no invalid recipe is executed.
        job["manifest"]["videos"][0]["story"] = "hajo"
        return job


class Senders(Fixture):
    def test_cadence_is_30_seconds_heartbeat_and_2_seconds_event_poll(self):
        self.assertEqual(monitoring.HEARTBEAT_SECONDS, 30)
        self.assertEqual(monitoring.EVENT_POLL_SECONDS, 2)

    def test_ready_declares_independence_without_production_authorization(self):
        self.transport.start()
        ready = next(e for e in self.events() if e["kind"] == "monitor_ready")
        self.assertTrue(ready["result"]["independent_heartbeat"])
        self.assertTrue(ready["result"]["independent_events"])
        self.assertFalse(ready["result"]["production_authorized"])
        self.assertEqual(ready["result"]["heartbeat_interval_seconds"], 30)

    def test_slow_events_do_not_suppress_heartbeat_while_main_render_is_blocked(self):
        event_entered, release_events, heartbeat = threading.Event(), threading.Event(), threading.Event()
        with self.state.transaction() as db:
            self.state.emit(db, "command_result", "delivery", {"status": "queued"})
        def request(op, body):
            if op == "events":
                event_entered.set()
                release_events.wait(3)
                return {"acknowledged_event_id": body["event_id"]}
            if op == "heartbeat":
                heartbeat.set()
            return {}
        self.client.request.side_effect = request
        try:
            self.transport.start()
            self.assertTrue(event_entered.wait(2))
            self.assertTrue(heartbeat.wait(2))
            self.assertFalse(release_events.is_set())
        finally:
            release_events.set()

    def test_wrong_ack_preserves_exact_monitor_event_across_restart(self):
        with self.state.transaction() as db:
            monitoring.emit(self.state, db, "monitor_ready", "factory-test", {"observed_at": 123})
        original = self.events()[0]
        self.client.request.side_effect = lambda op, body: {"acknowledged_event_id": "wrong"}
        self.transport.send_events_once()
        restarted = State(self.state.path)
        self.transport.state = restarted
        self.transport.send_events_once()
        bodies = [c.args[1] for c in self.client.request.call_args_list]
        self.assertEqual(bodies, [original, original])

    def test_matching_ack_is_the_only_way_to_remove_monitor_pending(self):
        with self.state.transaction() as db:
            monitoring.emit(self.state, db, "monitor_ready", "factory-test", {})
        self.transport.send_events_once()
        self.transport.send_events_once()
        self.assertEqual(self.client.request.call_count, 1)

    def test_unsupported_new_event_does_not_block_legacy_error(self):
        with self.state.transaction() as db:
            monitoring.emit(self.state, db, "monitor_ready", "factory-test", {})
            self.state.emit(db, "final_error", "job", {"code": "low_disk"})
        def request(op, body):
            if body["kind"] == "monitor_ready":
                raise ValueError("private-response-text")
            return {"acknowledged_event_id": body["event_id"]}
        self.client.request.side_effect = request
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.transport.send_events_once()
        self.assertEqual(self.state.pending(), [])
        self.assertNotIn("private-response-text", out.getvalue())
        with self.state.transaction() as db:
            self.assertEqual(db.execute("SELECT sent FROM monitor_outbox").fetchone()[0], 0)

    def test_failed_legacy_event_does_not_starve_new_stream(self):
        with self.state.transaction() as db:
            monitoring.emit(self.state, db, "monitor_ready", "factory-test", {})
            self.state.emit(db, "final_error", "job", {"code": "low_disk"})
        def request(op, body):
            if body["kind"] == "final_error":
                raise ValueError("unavailable")
            return {"acknowledged_event_id": body["event_id"]}
        self.client.request.side_effect = request
        with contextlib.redirect_stdout(io.StringIO()):
            self.transport.send_events_once()
        self.assertEqual(len(self.state.pending()), 1)
        with self.state.transaction() as db:
            self.assertEqual(db.execute("SELECT sent FROM monitor_outbox").fetchone()[0], 1)

    def test_heartbeat_keeps_legacy_schema_and_true_pending_count(self):
        with self.state.transaction() as db:
            for n in range(51):
                self.state.emit(db, "final_error", str(n), {"code": "low_disk"})
        self.transport.heartbeat_once()
        self.client.request.assert_called_once_with("heartbeat", {
            "schema_version": 1, "agent_id": "factory-test", "takeover_approved": True, "pending_events": 51})

    def test_transport_never_claims_commands(self):
        self.transport.heartbeat_once()
        self.transport.send_events_once()
        self.assertEqual([c.args[0] for c in self.client.request.call_args_list], ["heartbeat"])


class Progress(Fixture):
    def test_queued_never_emits_started(self):
        self.job()
        self.assertEqual(self.events(), [])

    def test_blocked_queue_reports_reason_without_start_or_job_mutation(self):
        job = self.job()
        with self.state.transaction() as db:
            db.execute("UPDATE jobs SET status='queued',lease=NULL,expires=NULL")
            db.execute("UPDATE recipes SET manifest=?", (json.dumps(job["manifest"]),))
        with patch("seven_series.targeted", return_value=True):
            self.state.monitor_waiting("production_lock_busy")
        event = self.events()[0]
        self.assertEqual((event["kind"], event["result"]["reason"]), ("scheduler_waiting", "production_lock_busy"))
        with self.state.transaction() as db:
            self.assertEqual(db.execute("SELECT status,lease FROM jobs").fetchone()["status"], "queued")
        self.assertNotIn("started_verified", [e["kind"] for e in self.events()])

    def test_same_waiting_reason_does_not_emit_every_loop(self):
        runner = Runner({"archive_root": str(self.root / "archive")}, self.state)
        with patch.object(self.state, "monitor_waiting") as emit:
            runner.report_waiting("production_lock_busy")
            runner.report_waiting("production_lock_busy")
            runner.report_waiting("legacy_producer_active")
        self.assertEqual([c.args[0] for c in emit.call_args_list], ["production_lock_busy", "legacy_producer_active"])

    def test_no_jobs_yet_does_not_suppress_later_blocked_queue_alert(self):
        runner = Runner({"archive_root": str(self.root / "archive")}, self.state)
        with patch.object(self.state, "monitor_waiting", side_effect=[False, True]) as emit:
            runner.report_waiting("production_lock_busy")
            runner.report_waiting("production_lock_busy")
            runner.report_waiting("production_lock_busy")
        self.assertEqual(emit.call_count, 2)

    def test_non_series_legacy_job_emits_no_new_progress(self):
        job = self.job()
        self.state.monitor_video(job, "preparing")
        self.assertEqual(self.events(), [])

    def test_started_binds_job_recipe_language_cursor_attempt_and_container(self):
        job = self.job()
        with patch("seven_series.targeted", return_value=True):
            self.state.monitor_video(job, "rendering", container_id="d" * 64, evidence="docker_running")
        e = self.events()[0]
        self.assertEqual(e["kind"], "started_verified")
        self.assertEqual(e["entity_id"], job["id"])
        self.assertEqual((e["result"]["language"], e["result"]["story"], e["result"]["cursor"],
                          e["result"]["attempt"], e["result"]["container_id"]), ("en", "hajo", 0, 0, "d" * 64))
        self.assertEqual(e["result"]["recipe_sha256"], digest(job["manifest"]))

    def test_lost_lease_cannot_publish_induction_or_progress(self):
        job = self.job()
        job["lease"] = "stale"
        with patch("seven_series.targeted", return_value=True), self.assertRaisesRegex(ValueError, "lease_lost"):
            self.state.monitor_video(job, "rendering")
        self.assertEqual(self.events(), [])

    def test_archived_event_commits_with_output_and_no_fake_start(self):
        job = self.job()
        key = "test/v1/lesson-en"
        receipt = {"sha256": "a" * 64, "bytes": 1, "object_key": key}
        with patch("seven_series.targeted", return_value=True):
            self.state.finish_video(job, key, receipt)
        e = self.events()[0]
        self.assertEqual(e["kind"], "video_archived")
        self.assertTrue(e["result"]["archive_verified"])
        self.assertEqual(e["result"]["completed_cursor"], 1)
        self.assertEqual(e["result"]["receipt"], self.state.output(key))
        self.assertEqual(e["result"]["status"], "completed")
        self.assertNotIn("started_verified", [e["kind"] for e in self.events()])

    def test_final_error_uses_existing_durable_queue_and_matching_failed_attempt(self):
        job = self.job()
        stored = {"at": 123, "job_id": job["id"], "recipe_id": job["recipe"], "version": job["version"],
                  "attempt": job["attempts"], "cursor": 0, "code": "render_or_verification_failed",
                  "detail": {"stderr_tail": "sim_caption_cannot_fit PRIVATE-MARKER", "where": ["agent.py:1 render"]}}
        bound = {"id": job["id"], "recipe": job["recipe"], "version": job["version"],
                 "attempts": job["attempts"], "recipe_sha256": digest(job["manifest"])}
        report = failure_report.build(stored, bound, "factory-test", [])
        self.state.fail(job, "render_or_verification_failed", failure_report=report)
        error = next(e for e in self.state.pending() if e["kind"] == "final_error")
        self.assertEqual(error["result"]["failure_report"]["errors"][0]["detail_codes"], ["sim_caption_cannot_fit"])
        self.assertNotIn("PRIVATE-MARKER", json.dumps(error))
        self.assertEqual(error["result"]["failure_report"]["attempt"], 0)
        with self.state.transaction() as db:
            self.assertEqual(db.execute("SELECT attempts FROM jobs").fetchone()[0], 1)

    def test_runner_builds_and_emits_bound_detail_before_attempt_increment(self):
        job = self.job()
        runner = Runner({"archive_root": str(self.root / "archive"), "work_root": str(self.root / "work"),
                         "production_lock": str(self.root / "production.lock"), "takeover_approved": True,
                         "agent_id": "factory-test"}, self.state)
        with patch.object(self.state, "claim", return_value=job), \
             patch("agent.subprocess.run", return_value=MagicMock(returncode=1)), \
             patch.object(runner, "render", side_effect=ValueError("sim_caption_cannot_fit")), \
             contextlib.redirect_stdout(io.StringIO()):
            runner.run_one()
        error = next(e for e in self.state.pending() if e["kind"] == "final_error")
        report = error["result"]["failure_report"]
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["attempt"], 0)
        self.assertEqual(report["errors"][0]["detail_codes"], ["sim_caption_cannot_fit"])


class ContainerEvidence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.scratch = Path(self.temp.name)

    def process(self, returncode=0):
        p = MagicMock()
        p.__enter__.return_value = p
        p.returncode = returncode
        return p

    def test_running_pinned_container_emits_exactly_once(self):
        p = self.process()
        p.communicate.side_effect = [subprocess.TimeoutExpired("docker", 1),
                                     subprocess.TimeoutExpired("docker", 1), (None, b"")]
        start = MagicMock()
        with patch("agent.subprocess.Popen", return_value=p), \
             patch("agent.Path.read_text", return_value="b" * 64), \
             patch("agent.subprocess.check_output", return_value="true sha256:" + "a" * 64 + " " + "b" * 64) as inspect:
            render_process(["docker"], "sha256:" + "a" * 64, start, scratch_root=self.scratch)
        start.assert_called_once_with("b" * 64)
        self.assertEqual(inspect.call_count, 1)

    def test_wrong_image_is_not_induction_evidence(self):
        p = self.process()
        p.communicate.side_effect = [subprocess.TimeoutExpired("docker", 1), (None, b"")]
        start = MagicMock()
        with patch("agent.subprocess.Popen", return_value=p), \
             patch("agent.Path.read_text", return_value="b" * 64), \
             patch("agent.subprocess.check_output", return_value="true sha256:" + "c" * 64 + " " + "b" * 64):
            render_process(["docker"], "sha256:" + "a" * 64, start, scratch_root=self.scratch)
        start.assert_not_called()

    def test_other_running_container_cannot_prove_this_attempt_started(self):
        p = self.process()
        p.communicate.side_effect = [subprocess.TimeoutExpired("docker", 1), (None, b"")]
        start = MagicMock()
        with patch("agent.subprocess.Popen", return_value=p), \
             patch("agent.Path.read_text", return_value="b" * 64), \
             patch("agent.subprocess.check_output", return_value="true sha256:" + "a" * 64 + " " + "c" * 64):
            render_process(["docker", "run"], "sha256:" + "a" * 64, start, scratch_root=self.scratch)
        start.assert_not_called()

    def test_immediate_docker_error_does_not_emit_start(self):
        p = self.process(returncode=125)
        p.communicate.return_value = (None, b"no image")
        start = MagicMock()
        with patch("agent.subprocess.Popen", return_value=p), self.assertRaises(subprocess.CalledProcessError):
            render_process(["docker"], "sha256:" + "a" * 64, start, scratch_root=self.scratch)
        start.assert_not_called()

    def test_timeout_kills_client_and_preserves_failure(self):
        p = self.process()
        p.communicate.return_value = (None, b"")
        with patch("agent.subprocess.Popen", return_value=p), patch("agent.time.monotonic", side_effect=[0, 7201]), \
             self.assertRaises(subprocess.TimeoutExpired):
            render_process(["docker"], "sha256:" + "a" * 64, MagicMock(), scratch_root=self.scratch)
        p.kill.assert_called_once()

    def test_readonly_global_tmp_does_not_block_docker_and_cid_stays_outside_work(self):
        p = self.process()
        p.communicate.return_value = (None, b"")
        renderer_work = self.scratch / "0"
        renderer_work.mkdir()
        def inspect_command(command, **kwargs):
            cid = Path(command[command.index("--cidfile") + 1])
            self.assertEqual(cid.parent.parent, self.scratch)
            self.assertNotEqual(cid.parent, renderer_work)
            self.assertEqual(cid.parent.stat().st_mode & 0o777, 0o700)
            self.assertFalse(cid.exists())
            return p
        with patch("tempfile._get_default_tempdir", side_effect=FileNotFoundError("read-only global tmp")), \
             patch("agent.subprocess.Popen", side_effect=inspect_command) as spawn:
            render_process(["docker", "run", "--rm"], "sha256:" + "a" * 64,
                           MagicMock(), scratch_root=self.scratch)
        spawn.assert_called_once()
        self.assertEqual(list(self.scratch.iterdir()), [renderer_work])

    def test_missing_authorized_scratch_fails_closed_before_docker(self):
        with patch("agent.subprocess.Popen") as spawn, self.assertRaises(FileNotFoundError):
            render_process(["docker", "run"], "sha256:" + "a" * 64,
                           MagicMock(), scratch_root=self.scratch / "missing")
        spawn.assert_not_called()


class ErrorCodes(unittest.TestCase):
    def test_v2_preserves_all_legacy_codes(self):
        root = Path(__file__).parent
        legacy = json.loads((root / "renderer_error_codes.json").read_text())
        self.assertTrue(set(legacy["codes"]).issubset(failure_report.KNOWN_CODES))
        self.assertEqual(failure_report.CODES_VERSION, "renderer-error-codes-v2")

    def test_seven_story_caption_binding_and_bounds_have_concrete_diagnosis(self):
        job = {"id": "job-test", "recipe": "seven-stories-hajo-series", "version": "v1",
               "attempts": 0, "recipe_sha256": "a" * 64}
        stored = {"at": 123, "job_id": job["id"], "recipe_id": job["recipe"], "version": job["version"],
                  "attempt": 0, "code": "render_or_verification_failed",
                  "detail": {"message": "seven_caption_missing seven_series_renderer_binding seven_unsafe_bounds PRIVATE-MARKER",
                             "where": ["agent.py:1 render"]}}
        report = failure_report.build(stored, job, "factory-test", [])
        self.assertEqual(report["errors"][0]["detail_codes"],
                         ["seven_caption_missing", "seven_series_renderer_binding", "seven_unsafe_bounds"])
        self.assertNotIn("PRIVATE-MARKER", json.dumps(report))


if __name__ == "__main__":
    unittest.main()