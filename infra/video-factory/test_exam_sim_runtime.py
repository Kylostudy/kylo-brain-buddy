import copy, sys, unittest, uuid
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import exam_sim_runtime as rt, exam_simulator as es  # noqa: E402
from test_exam_simulator import manifest as renderer_manifest  # noqa: E402


def envelope():
    m = renderer_manifest()
    return {"schema_version": 1, "recipe_id": m["recipe"], "version": m["version"], "renderer": m["renderer"],
            "series": "other", "languages": ["hu"], "files": m["files"], "videos": m["videos"]}


class ExamSimWiring(unittest.TestCase):
    def test_renderer_copy_unchanged_and_v1_decisions_identical(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("es_img", HERE / "exam-simulator-renderer/validation/exam_simulator.py")
        img = importlib.util.module_from_spec(spec); spec.loader.exec_module(img)
        self.assertEqual(img.VERSION, "v1")
        m = renderer_manifest()
        self.assertEqual(es.diagnose(m), img.diagnose(m))
        bad = copy.deepcopy(m); bad["videos"][0]["language"] = "fr"
        self.assertEqual(es.diagnose(bad), img.diagnose(bad))

    def test_v2_recipe_from_kylogic_timing_accepted(self):
        import json
        r = json.loads((HERE / "vizsgaszimulator-hu-trial-v2-recipe.json").read_text())
        self.assertEqual(rt.diagnose(r), [])
        self.assertTrue(es.validate_request(rt.request(r, r["videos"][0])))

    def test_v2_with_old_narration_and_v1_with_new_narration_rejected(self):
        import json
        r = json.loads((HERE / "vizsgaszimulator-hu-trial-v2-recipe.json").read_text())
        old = copy.deepcopy(r)
        for f in old["files"]:
            if f["key"] == "audio/vo-hu-wav":
                f["sha256"], f["bytes"] = es.PINNED["audio/vo-hu-wav"]
        self.assertTrue(any("checksum" in x for x in rt.diagnose(old)))
        mixed = copy.deepcopy(r); mixed["version"] = "v1"
        self.assertTrue(any("checksum" in x for x in rt.diagnose(mixed)))
        v4 = copy.deepcopy(r); v4["version"] = "v4"
        self.assertTrue(any("version" in x for x in rt.diagnose(v4)))

    def test_factory_envelope_accepted_and_projection_passes_renderer_check(self):
        e = envelope()
        rt.validate_recipe(e)
        self.assertTrue(es.validate_request(rt.request(e, e["videos"][0])))

    def test_other_language_or_extra_field_rejected_with_all_errors(self):
        e = envelope(); e["languages"] = ["fr"]; e["continuation"] = {}; e["videos"][0]["language"] = "fr"
        errs = rt.diagnose(e)
        self.assertTrue(any("languages" in x for x in errs) and any("unknown fields" in x for x in errs) and any("only hu" in x for x in errs))
        with self.assertRaises(ValueError):
            rt.validate_recipe(e)

    def test_second_video_rejected(self):
        e = envelope(); v = copy.deepcopy(e["videos"][0]); v["video_id"] = "masodik"; e["videos"].append(v)
        with self.assertRaises(ValueError):
            rt.validate_recipe(e)

    def test_series_start_forbidden(self):
        cmd = {"schema_version": 1, "delivery_id": str(uuid.uuid4()), "operation": "start_series",
               "payload": {"recipe_id": es.RECIPE, "version": "v1", "approval": {"approval_id": str(uuid.uuid4()), "recipe_sha256": "a" * 64,
                           "trial_receipt_sha256": "b" * 64, "approved_at": 1, "owner_authorized": True}}}
        with self.assertRaises(ValueError):
            rt.validate_command(cmd)

    def test_registration_through_state_creates_one_trial_job_and_no_series(self):
        import tempfile, state
        with tempfile.TemporaryDirectory() as d:
            st = state.State(Path(d) / "s.sqlite3")
            reg = {"schema_version": 1, "delivery_id": str(uuid.uuid4()), "operation": "register_recipe", "payload": envelope()}
            r = st.apply(reg)
            self.assertEqual(r["status"], "registered")
            t1 = st.apply({"schema_version": 1, "delivery_id": str(uuid.uuid4()), "operation": "trial", "payload": {"recipe_id": es.RECIPE, "version": "v1"}})
            t2 = st.apply({"schema_version": 1, "delivery_id": str(uuid.uuid4()), "operation": "trial", "payload": {"recipe_id": es.RECIPE, "version": "v1"}})
            self.assertEqual(t1["id"], t2["id"])

    def test_protected_windows_are_scene5_and_cta_to_end(self):
        self.assertEqual(rt.protected_ms(envelope()["videos"][0]), [(13633, 16633), (20067, 27766)])

    def test_cut_plan_only_frozen_and_silent_outside_protection(self):
        prot = rt.protected_ms(envelope()["videos"][0])
        # frozen 1.0-3.0 s, silent 2.0-4.0 s -> only 2.0-3.0 s removable
        kept, removed = rt.plan([(1.0, 3.0), (13.0, 17.0), (21.0, 27.0)], [(2.0, 4.0), (13.0, 17.0), (21.0, 27.0)], prot, 833)
        self.assertEqual(removed, [[60, 90], [390, 408], [499, 510]])
        self.assertTrue(all(not (f * 1000 / 30 + 33 > 13633 and f * 1000 / 30 < 16633) for a, b in removed for f in range(a, b)))
        self.assertEqual(len(kept), 833 - 59)

    def test_no_gap_means_no_cut(self):
        kept, removed = rt.plan([(1.0, 3.0)], [(5.0, 6.0)], [], 833)
        self.assertEqual((len(kept), removed), (833, []))


class V3RecipeTest(unittest.TestCase):
    def test_v3_recipe_accepted_and_v2_audio_rejected(self):
        import json, exam_sim_runtime as r
        d = json.loads((HERE / "vizsgaszimulator-hu-trial-v3-recipe.json").read_text())
        self.assertEqual(r.diagnose(d), [])
        self.assertEqual(d["videos"][0]["timing"]["sceneFrames"], [97, 134, 135, 119, 90, 94, 240])
        bad = json.loads(json.dumps(d))
        for f in bad["files"]:
            if f["key"] == "audio/vo-hu-wav":
                f.update(sha256="506cd25c8d8c9e491131ac3e9d72af3467e44bb167f6d45153f343eeebfaaff1", bytes=2578458)
        self.assertTrue(any("checksum" in e for e in r.diagnose(bad)))


if __name__ == "__main__":
    unittest.main()
