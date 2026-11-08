"""Inert policy tests; never render or call production providers."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from contract import validate_recipe, validate_command
from piggy import scene_frames
from test_factory import command
from state import State


def recipe():
    text = {"heading":"Mennyibe kerül havonta a tanulásod?", "disclaimer":"Szemléltető előfizetési kosár. A tényleges díjak eltérhetnek.", "truth":"Több mint 100 USD/hó", "price":"29,99 USD/hó", "steps":["Jegyzet","Magyarázat","Tanulókártya","Gyakorlókérdés"], "counter_values":[20,35,55,80,105], "labels":["Jegyzetelés","Kvízek","Tételkidolgozás","Nyelvi gyakorlás","Eszközök"], "outro_url":"kylo.study", "outro_tagline":"Your AI tutor"}
    video = {"video_id":"malacpersely-hu", "language":"hu","width":1080,"height":1920,"duration_ms":39000,"scene":"piggy-bank-v1","text":json.dumps(text),"subtitle":json.dumps({"subs":[]}),"cta":json.dumps({"text":"Próbáld ki ingyen!","supporting_text":"14 napos ingyenes próba","trial_days":14}),"audio":"audio/vo-hu-mp3","master":"data/scene-frames-json","timing":[{"start_ms":a,"end_ms":b} for a,b in zip([0,4000,14000,18000,28000,33000,36000],[4000,14000,18000,28000,33000,36000,39000])]}
    return {"schema_version":1,"recipe_id":"malacpersely-hu-trial","version":"v1","renderer":"piggy-bank-safe-v1","series":"other","languages":["hu"],"videos":[video],"files":[{"key":k,"bytes":4,"sha256":hashlib.sha256(b"data").hexdigest()} for k in (video["audio"],video["master"])]}


class PiggyTests(unittest.TestCase):
    def test_one_hu_accepted(self):
        r=recipe(); self.assertEqual(validate_recipe(r),r)

    def test_layout_fix_renderer_accepts_only_same_single_hu_trial(self):
        r=recipe();r['renderer']='piggy-bank-layout-safe-v2'
        self.assertEqual(validate_recipe(r),r)
        r['languages']=['hu','en']
        with self.assertRaisesRegex(ValueError,'piggy_hu_trial_only'):validate_recipe(r)

    def test_exact_seven_positive_integer_frames(self):
        self.assertEqual(scene_frames([120,300,120,300,150,90,90]),[120,300,120,300,150,90,90])
        for value in ([],[1]*6,[1]*8,[0]*7,[-1]*7,[True]*7,[1.1]*7,[float("nan")]*7,[float("inf")]*7):
            with self.subTest(value=value), self.assertRaises(ValueError): scene_frames(value)

    def test_wrong_language_rejected(self):
        r=recipe();r["languages"]=["de"];r["videos"][0]["language"]="de"
        with self.assertRaisesRegex(ValueError,"piggy_hu_trial_only"):validate_recipe(r)

    def test_multiple_outputs_rejected(self):
        r=recipe();v=copy.deepcopy(r["videos"][0]);v["video_id"]="second";r["videos"].append(v)
        with self.assertRaisesRegex(ValueError,"piggy_hu_trial_only"):validate_recipe(r)

    def test_multiple_languages_rejected(self):
        r=recipe();r["languages"].append("en")
        with self.assertRaisesRegex(ValueError,"piggy_hu_trial_only"):validate_recipe(r)

    def test_unknown_scene_rejected(self):
        r=recipe();r["videos"][0]["scene"]="unknown"
        with self.assertRaisesRegex(ValueError,"piggy_invalid_scene"):validate_recipe(r)

    def test_wrong_renderer_identity_rejected(self):
        r=recipe();r["recipe_id"]="another"
        with self.assertRaisesRegex(ValueError,"piggy_hu_trial_only"):validate_recipe(r)

    def test_bad_path_rejected(self):
        r=recipe();r["files"][0]["key"]="../escape"
        with self.assertRaisesRegex(ValueError,"invalid_object_key"):validate_recipe(r)

    def test_bad_checksum_rejected(self):
        r=recipe();r["files"][0]["sha256"]="wrong"
        with self.assertRaisesRegex(ValueError,"invalid_checksum"):validate_recipe(r)

    def test_noncontiguous_timing_rejected(self):
        r=recipe();r["videos"][0]["timing"][1]["start_ms"]+=100
        with self.assertRaisesRegex(ValueError,"piggy_invalid_timing"):validate_recipe(r)

    def test_105_counter_preserved(self):
        r=recipe();v=r["videos"][0];text=json.loads(v["text"]);text["counter_values"][-1]=100;v["text"]=json.dumps(text)
        with self.assertRaisesRegex(ValueError,"piggy_invalid_offer"):validate_recipe(r)

    def test_2999_price_preserved(self):
        r=recipe();v=r["videos"][0];text=json.loads(v["text"]);text["price"]="19,99 USD/hó";v["text"]=json.dumps(text)
        with self.assertRaisesRegex(ValueError,"piggy_invalid_offer"):validate_recipe(r)

    def test_14_day_trial_preserved(self):
        r=recipe();v=r["videos"][0];cta=json.loads(v["cta"]);cta["trial_days"]=7;v["cta"]=json.dumps(cta)
        with self.assertRaisesRegex(ValueError,"piggy_invalid_cta"):validate_recipe(r)

    def test_series_command_rejected(self):
        c=command("start_series",{"recipe_id":"malacpersely-hu-trial","version":"v1","approval":{}})
        with self.assertRaisesRegex(ValueError,"trial_only_recipe"):validate_command(c)

    def test_version_two_series_rejected(self):
        c=command("series_run",{"recipe_id":"malacpersely-hu-trial","version":"v1","approval":{}});c["schema_version"]=2
        from universal import FactoryError
        with self.assertRaises(FactoryError) as caught:validate_command(c)
        self.assertEqual(caught.exception.result["code"],"trial_only_recipe")

    def test_version_two_recipe_rejected(self):
        r=recipe();r["schema_version"]=2
        with self.assertRaisesRegex(ValueError,"piggy_hu_trial_only"):validate_recipe(r)

    def test_trial_queue_only(self):
        with tempfile.TemporaryDirectory() as temp:
            state=State(Path(temp)/"state.sqlite3");state.apply(command("register_recipe",recipe()))
            result=state.apply(command("trial",{"recipe_id":"malacpersely-hu-trial","version":"v1"}))
            self.assertEqual(result["status"],"queued")

    def test_subtitle_must_end_before_black_outro(self):
        r=recipe();r["videos"][0]["subtitle"]=json.dumps({"subs":[{"start_ms":35000,"end_ms":37000,"text":"Late"}]})
        with self.assertRaisesRegex(ValueError,"piggy_invalid_subtitles"):validate_recipe(r)