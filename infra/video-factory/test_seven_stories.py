import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import uuid
import seven_stories as s
from recipe_runtime import validate_recipe, validate_command
from state import State
from seven_media import waveform_metrics, verify_layout

HERE = Path(__file__).parent

def command(op, payload):
    return {"schema_version":1,"delivery_id":str(uuid.uuid4()),"operation":op,"payload":payload}


class SevenStories(unittest.TestCase):
    def test_seven_separate_hungarian_trials(self):
        self.assertEqual(set(s.STORIES),{"hajo","auto","repulo","ust","szamlatorony","hatizsak","malacpersely-uj"})
        for story in s.STORIES:
            p = s.template(story)
            self.assertEqual(validate_recipe(p),p)
            self.assertEqual(p["languages"],["hu"])
            self.assertEqual(len(p["videos"]),1)

    def test_original_audio_hash_cannot_change(self):
        p=s.template("hajo");p["files"][0]["sha256"]="a"*64
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_owner_approval_binds_exact_original_mp3(self):
        for story in s.STORIES:
            p=s.template(story);t=p["videos"][0]["timeline"]
            self.assertEqual(t["owner_approval"]["approved_audio_sha256"],p["files"][0]["sha256"])
            p["videos"][0]["timeline"]["owner_approval"]["approved_audio_sha256"]=""
            with self.assertRaises(ValueError):validate_recipe(p)

    def test_no_speedup(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["audio_policy"]["playback_rate"]=1.01
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_no_trimming(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["audio_policy"]["trim"]=True
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_no_regeneration(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["audio_policy"]["regenerate"]=True
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_audio_starts_at_zero(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["audio_policy"]["start_ms"]=100
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_entire_timeline_protected(self):
        p=s.template("hajo");t=p["videos"][0]["timeline"]
        self.assertEqual(t["protected_windows_ms"],[{"start_ms":0,"end_ms":23200}])
        t["protected_windows_ms"]=[]
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_no_tempo_filters(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["audio_policy"]["speed_filters"]=["atempo=1.1"]
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_outro_hold_two_seconds(self):
        for story in s.STORIES:
            t=s.template(story)["videos"][0]["timeline"]
            self.assertGreaterEqual(t["duration_ms"]-t["audio_duration_seconds"]*1000,2000)

    def test_scene_frames_are_only_time_source(self):
        p=s.template("hajo");p["videos"][0]["timeline"]["sceneFrames"][0]-=1
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_cross_topic_audio_rejected(self):
        p=s.template("hajo");p["files"]=s.template("auto")["files"]
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_other_languages_rejected(self):
        p=s.template("hajo");p["languages"]=["en"]
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_series_rejected(self):
        with self.assertRaisesRegex(ValueError,"trial_only_recipe"):
            validate_command(command("start_series",{"recipe_id":s.template("hajo")["recipe_id"],"version":"v1"}))

    def test_exactly_one_job_per_topic(self):
        with tempfile.TemporaryDirectory() as d:
            state=State(Path(d)/"state.db")
            for story in s.STORIES:
                p=s.template(story);state.apply(command("register_recipe",p))
                payload={"recipe_id":p["recipe_id"],"version":"v1"}
                a=state.apply(command("trial",payload));b=state.apply(command("trial",payload))
                self.assertEqual(a["id"],b["id"])
            with state.transaction() as db:self.assertEqual(db.execute("select count(*) from jobs").fetchone()[0],7)

    def test_no_price_override(self):
        p=s.template("malacpersely-uj");p["videos"][0]["price"]="29.99 USD"
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_cta_fourteen_days(self):
        p=s.template("hajo");self.assertEqual(p["videos"][0]["timeline"]["cta"],"Próbáld ki ingyen 14 napig!")
        p["videos"][0]["timeline"]["cta"]="Próbáld ki ingyen 7 napig!"
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_collects_all_recipe_errors(self):
        p=s.template("hajo");p["languages"]=["en"];p["files"][0]["sha256"]="";p["videos"][0]["width"]=720
        self.assertEqual(len(s.diagnose(p)),3)

    def test_waveform_exact_same_start(self):
        a=[1000,-2000,3000,-1500]*100
        self.assertEqual(waveform_metrics(a,a+[0]*100)["similarity"],1)
        with self.assertRaises(ValueError):waveform_metrics(a,[0]+a)

    def test_waveform_rejects_shortened_audio(self):
        with self.assertRaisesRegex(ValueError,"seven_audio_truncated"):waveform_metrics([1,2,3],[1,2])

    def test_release_contains_all_new_runtime_files(self):
        for script in ("install.sh","activate-manager.sh"):
            text=(HERE/script).read_text()
            for name in ("recipe_runtime.py","seven_stories.py","seven_media.py","seven_preflight.py","seven-stories-approved.json"):
                self.assertIn(name,text)

    def test_host_and_renderer_validator_identical(self):
        for name in ("seven_stories.py","seven_media.py","seven-stories-approved.json"):
            self.assertEqual((HERE/name).read_bytes(),(HERE/"seven-stories-renderer/validation"/name).read_bytes())

    def test_missing_frame_evidence_blocks_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"layout.jsonl";p.write_text("[]\n")
            with self.assertRaises(ValueError):verify_layout(p,s.template("hajo")["videos"][0])

    def test_zone_cannot_be_expanded(self):
        p=s.template("hajo");self.assertEqual(p["videos"][0]["timeline"]["safe_zone"],{"left":65,"right":950,"top":231,"bottom":1459})
        p["videos"][0]["timeline"]["safe_zone"]["right"]=951
        with self.assertRaises(ValueError):validate_recipe(p)

    def test_preflight_collects_all_missing_inputs(self):
        from seven_preflight import run
        with tempfile.TemporaryDirectory() as d:
            r=run(d)
            self.assertEqual(len(r["stories"]),7)
            self.assertEqual(sum(len(s["errors"]) for s in r["stories"]),21)
            self.assertFalse(r["ok"])
            self.assertTrue(all("full_audio_decode" in s["skipped_checks"] for s in r["stories"]))

    def test_activation_grants_only_exact_seven_scenes(self):
        from test_reviewed_renderers import run, IMG
        code,cfg,_=run({s.RENDERER:{"image":IMG,"reviewed":True,"scenes":s.SCENES}})
        self.assertEqual(code,0)
        self.assertEqual(cfg["renderers"][s.RENDERER]["scenes"],s.SCENES)
        code,_,_=run({s.RENDERER:{"image":IMG,"reviewed":True,"scenes":["piggy-bank-v1"]}})
        self.assertNotEqual(code,0)


if __name__ == "__main__":unittest.main()