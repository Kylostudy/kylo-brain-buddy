import tempfile, unittest
from pathlib import Path
import failure_report as fr

STORED = {"at": 1763410000, "job_id": "J1", "cursor": 0, "recipe_id": "vizsgaszimulator-hu-trial", "version": "v3",
          "video_id": "vizsgaszimulator-hu-v4-r3", "code": "render_or_verification_failed",
          "detail": {"type": "CalledProcessError", "message": "Command '['docker','run']' returned 1",
                     "where": ["agent.py:160 render"], "path": "/var/lib/secret/x",
                     "stderr_tail": "Error: sim_element_outside_safe_zone scene 3 frame 412 audio/vo-hu SECRET=abc /home/kylo/x"}}

class T(unittest.TestCase):
    def test_bound_to_job_and_sanitized(self):
        r = fr.build(STORED, "J1", "vps-1", "3c6b")
        e = r["errors"][0]
        self.assertEqual((r["status"], e["stage"], e["scene"], e["frame"]), ("failed", "render", 3, 412))
        self.assertEqual(e["detail_codes"], ["sim_element_outside_safe_zone"])
        body = fr.canonical(r).decode()
        for leak in ("SECRET", "/home/", "/var/lib", "docker", "agent.py"):
            self.assertNotIn(leak, body)
        self.assertFalse(r["production_authorized"])

    def test_other_job_is_unavailable(self):
        self.assertEqual(fr.build(STORED, "J2", "vps-1", "x")["status"], "diagnostic_unavailable")
        self.assertEqual(fr.build(None, "J2", "vps-1", "x")["status"], "diagnostic_unavailable")

    def test_outbox_idempotent_and_ack_exact(self):
        with tempfile.TemporaryDirectory() as d:
            box = fr.Outbox(str(Path(d) / "o.db"))
            r = fr.build(STORED, "J1", "vps-1", "x")
            self.assertTrue(box.put(r))
            self.assertEqual(box.put(fr.build(STORED, "J1", "vps-1", "x")), "kept_original")
            self.assertFalse(box.ack("J1", "wrong"))
            self.assertTrue(box.ack("J1", r["report_sha256"]))
            self.assertFalse(box.ack("J1", r["report_sha256"]))
            self.assertEqual(box.pending(), [])

if __name__ == "__main__":
    unittest.main()
