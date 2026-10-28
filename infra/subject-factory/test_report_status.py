import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("report_status", Path(__file__).with_name("report-status.py"))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class DiagnosticsTests(unittest.TestCase):
    def test_sensitive_lines_are_never_forwarded(self):
        for secret in ["Authorization: Bearer private", "https://host/file?signature=private", "password=private", "WORKER_API_TOKEN=private", "cookie=private", "api_key=private"]:
            self.assertNotIn("private", report.sanitize(secret))
        self.assertEqual(report.sanitize("ERROR: Docker build failed"), "ERROR: Docker build failed")

    def test_output_is_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "log"
            p.write_text("x" * 30000 + "\nactual failure")
            result = report.tail_file(p)
            self.assertTrue(result["available"])
            self.assertLessEqual(len(result["tail"]), 12000)
            self.assertTrue(result["tail"].endswith("actual failure"))

    def test_missing_log_is_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(report.tail_file(Path(d) / "missing"), {"available": False, "error": "missing"})

    def test_only_fixed_units_and_files_are_read(self):
        with patch.object(report, "command", return_value="ActiveState=failed") as commands, patch.object(report, "tail_file", return_value={"available": False}) as files:
            result = report.collect()
            self.assertEqual(set(result["units"]), {"kylo-subject-factory-install.service", "kylo-subject-factory.service"})
            self.assertEqual([c.args[0] for c in files.call_args_list], ["/var/log/kylo-subject-factory-install.log", "/opt/kylo-subject-factory/work/status.json", "/var/log/kylo-ielts-trial-install.log", "/var/lib/kylo-video-factory/ielts-trial-status.json", "/var/lib/kylo-video-factory/ielts-continuation-status.json", "/var/lib/kylo-video-factory/last-render-failure.json"])
            self.assertEqual(len(commands.call_args_list), 12)
            self.assertTrue(all(c.args[0][0] in ("systemctl", "journalctl") for c in commands.call_args_list))

    def test_factory_state_missing_db_is_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(report.factory_state(str(Path(d) / "none.sqlite3")), {"available": False, "error": "OperationalError"})

    def test_factory_state_reports_jobs_and_error_events_only(self):
        import sqlite3, json
        with tempfile.TemporaryDirectory() as d:
            f = str(Path(d) / "s.sqlite3")
            db = sqlite3.connect(f)
            db.execute("CREATE TABLE jobs(id TEXT, recipe TEXT, version TEXT, mode TEXT, status TEXT, attempts INTEGER, cursor INTEGER, manifest TEXT)")
            db.execute("INSERT INTO jobs VALUES('j','r','v','trial','failed',1,0,'SECRET_MANIFEST')")
            db.execute("CREATE TABLE outbox(id TEXT, body TEXT, sent INTEGER)")
            db.execute("INSERT INTO outbox VALUES('a',?,0)", (json.dumps({"type": "final_error", "payload": {"code": "render_or_verification_failed"}}),))
            db.execute("INSERT INTO outbox VALUES('b',?,0)", (json.dumps({"type": "batch_verified"}),))
            db.commit(); db.close()
            result = report.factory_state(f)
            self.assertEqual(result["jobs"][0]["status"], "failed")
            self.assertNotIn("SECRET_MANIFEST", json.dumps(result))
            self.assertEqual(len(result["error_events"]), 1)

    def test_config_is_data_not_shell(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config"
            p.write_text('WORKER_API_TOKEN="abc$()!"\nUNRELATED_SECRET=skip\n')
            self.assertEqual(report.load_config(p), {"WORKER_API_TOKEN": "abc$()!"})


if __name__ == "__main__":
    unittest.main()