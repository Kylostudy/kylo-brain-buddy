import tempfile, threading, unittest
from pathlib import Path
import failure_report as fr

H = "a" * 64
JOB = {"id": "J1", "recipe": "vizsgaszimulator-hu-trial", "version": "v3", "attempts": 1, "recipe_sha256": H}
KEYS = ["audio/vo-hu", "image/logo"]
MARK = "FAKE_MARKER_NOT_A_SECRET"

def stored(**kw):
    s = {"at": 1763410000, "job_id": "J1", "attempt": 1, "cursor": 0, "recipe_id": "vizsgaszimulator-hu-trial", "version": "v3",
         "video_id": "x", "code": "render_or_verification_failed",
         "detail": {"message": "returned 1", "where": ["agent.py:160 render"],
                    "stderr_tail": "Error: sim_caption_cannot_fit scene 3 frame 412 audio/vo-hu %s /home/kylo/x" % MARK}}
    s.update(kw); return s

class Report(unittest.TestCase):
    def test_sanitized_and_bound(self):
        r = fr.build(stored(), JOB, "vps-1", KEYS)
        e = r["errors"][0]
        self.assertEqual((r["status"], e["stage"], e["scene"], e["frame"], e["input_keys"]), ("failed", "render", 3, 412, ["audio/vo-hu"]))
        self.assertEqual(e["detail_codes"], ["sim_caption_cannot_fit"])
        body = fr.canonical(r).decode()
        for leak in (MARK, "/home/", "agent.py", "returned"):
            self.assertNotIn(leak, body)
        self.assertEqual(r["report_sha256"], fr.self_hash(r, "report_sha256"))

    def test_unknown_prefixed_code_not_passed(self):
        s = stored(detail={"stderr_tail": "sim_unregistered_fake_code", "where": []})
        self.assertEqual(fr.build(s, JOB, "vps-1", KEYS)["errors"][0]["detail_codes"], ["unknown_renderer_error"])

    def test_keys_only_from_inventory_and_not_inside_paths(self):
        s = stored(detail={"stderr_tail": "/srv/in/audio/vo-hu audio/other image/logo", "where": []})
        self.assertEqual(fr.build(s, JOB, "vps-1", KEYS)["errors"][0]["input_keys"], ["image/logo"])

    def test_file_fields_never_copied(self):
        s = stored(video_id={"x": "/abs"}, cursor="free text", code="/etc/passwd")
        r = fr.build(s, JOB, "vps-1", KEYS)
        body = fr.canonical(r).decode()
        self.assertNotIn("/abs", body); self.assertNotIn("/etc", body); self.assertNotIn("free text", body)
        self.assertEqual(r["errors"][0]["code"], "render_or_verification_failed")

    def test_unbound_cases(self):
        cases = {"failure_record_missing_or_malformed": [None, stored(detail="x"), stored(detail=None)],
                 "failure_record_other_job": [stored(job_id="J2")],
                 "failure_record_recipe_mismatch": [stored(recipe_id="/abs/path"), stored(version="v2")],
                 "failure_record_attempt_unproven": [stored(attempt=2), {k: v for k, v in stored().items() if k != "attempt"}],
                 "failure_record_time_invalid": [stored(at="now"), stored(at=0), stored(at=-1), stored(at=1.5)]}
        for reason, items in cases.items():
            for s in items:
                r = fr.build(s, JOB, "vps-1", KEYS)
                self.assertEqual((r["status"], r["reason"], r["errors"]), ("diagnostic_unavailable", reason, []))

    def test_bad_job_identity_rejected(self):
        for bad in ({**JOB, "recipe_sha256": "x"}, {**JOB, "id": "/abs"}, {**JOB, "attempts": "1"}, None):
            with self.assertRaises(ValueError):
                fr.build(stored(), bad, "vps-1", KEYS)


class Canonical(unittest.TestCase):
    def test_vectors(self):
        self.assertEqual(fr.canonical({"b": [2, 1], "a": {"é": "árvíztűrő"}.get("x", "árvíztűrő")}).decode(), '{"a":"árvíztűrő","b":[2,1]}')
        self.assertEqual(fr.canonical({"z": {"y": 1, "x": -5}}), b'{"z":{"x":-5,"y":1}}')

    def test_rejections(self):
        for v in ({"x": 1.0}, {"x": float("nan")}, {"x": float("inf")}, {"x": -0.0}, {"x": 2**53}, {"é": 1}, {"x": "\ud800"}):
            with self.assertRaises(fr.CanonicalError):
                fr.canonical(v)
        for raw in (b'{"a":1,"a":2}', b'{"x":1e3}', b'{"x":1.5}', b'{"x":NaN}', b'{"x":Infinity}', b'\xff', b'{"x":9007199254740992}'):
            with self.assertRaises(fr.CanonicalError):
                fr.parse_strict(raw)


class Box(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory(); self.path = str(Path(self.d.name) / "o.db"); self.box = fr.Outbox(self.path)
    def tearDown(self):
        self.d.cleanup()

    def test_unavailable_then_real_diagnosis(self):
        a = self.box.put(fr.build(None, JOB, "vps-1", KEYS))
        b = self.box.put(fr.build(stored(), JOB, "vps-1", KEYS))
        self.assertNotEqual(a["failure_id"], b["failure_id"])
        self.assertEqual(len(self.box.pending()), 2)

    def test_two_attempts_kept(self):
        self.box.put(fr.build(stored(), JOB, "vps-1", KEYS))
        self.box.put(fr.build(stored(attempt=2, at=1763410100), {**JOB, "attempts": 2}, "vps-1", KEYS))
        self.assertEqual(len(self.box.pending()), 2)

    def test_resend_keeps_original_and_conflict_detected(self):
        first = self.box.put(fr.build(stored(), JOB, "vps-1", KEYS))
        again = self.box.put(fr.build(stored(), JOB, "vps-1", KEYS, now=1))
        self.assertEqual((again["report_id"], again["report_sha256"]), (first["report_id"], first["report_sha256"]))
        tampered = fr.build(stored(), JOB, "vps-1", KEYS); tampered["errors"][0]["scene"] = 9
        with self.assertRaises(fr.Conflict):
            self.box.put(tampered)

    def test_concurrent_put_single_row(self):
        r = fr.build(stored(), JOB, "vps-1", KEYS)
        def go():
            fr.Outbox(self.path).put(dict(r, report_id=fr.uuid.uuid4().hex))
        ts = [threading.Thread(target=go) for _ in range(8)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(len(self.box.pending()), 1)

    def test_ack_exact(self):
        r = self.box.put(fr.build(stored(), JOB, "vps-1", KEYS))
        self.assertFalse(self.box.ack(r["report_id"], "0" * 64, "vps-1"))
        self.assertFalse(self.box.ack(r["report_id"], r["report_sha256"], "vps-2"))
        self.assertFalse(self.box.ack("other", r["report_sha256"], "vps-1"))
        self.assertTrue(self.box.ack(r["report_id"], r["report_sha256"], "vps-1"))
        self.assertFalse(self.box.ack(r["report_id"], r["report_sha256"], "vps-1"))
        self.assertEqual(self.box.pending(), [])

if __name__ == "__main__":
    unittest.main()
