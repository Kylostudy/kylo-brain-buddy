"""B policy tests. Synthetic bytes and mocked renderer; no sandbox media rendering."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from contract import digest, validate_recipe, validate_command
from storage import LocalArchive
from state import State
from universal import SAFE_ZONE, SCENES, FactoryError, check_layout, alignment, redact
from universal_state import claim, commit, fail
from universal_runtime import run, preflight


def recipe(languages=("hu", "de", "fi")):
    return {"schema_version":2,"recipe_id":"cambridge-b","version":"v1","renderer":"exam-promo-universal-v1","safe_zone":dict(SAFE_ZONE),"exam":{"name":"Cambridge B2 First","sections":[{"name":"Reading","time":"75 min","example":"Choose the correct answer."}],"score_scale":"140–190","sample_percent":82,"vocabulary":["improve","confident"],"skin":{"background":"#080808","foreground":"#FFFFFF","accent":"#E9B44C","muted":"#CCCCCC"}},"languages":list(languages),"files":[],"videos":[{"video_id":"cambridge-"+lang,"language":lang,"audio":"audio-"+lang,"alignment":"alignment-"+lang,"font":"font-"+lang,"dog":"dog","scenes":[{"kind":kind,"heading":"Example title","body":"Example body","weight":1,"forbidden":[]} for kind in SCENES[:7]],"cta":"Try Kylo","telegram":"t.me/kylostudy","outro_ms":3500} for lang in languages]}


def command(op,payload):
    return {"schema_version":2,"delivery_id":str(uuid.uuid4()),"operation":op,"payload":payload}


class UniversalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.archive=LocalArchive(self.root/"archive")
        self.state=State(self.root/"state.db",self.archive)
        self.r=recipe()
        self.state.apply(command("register_recipe",self.r))

    def params(self,**extra): return {"recipe_id":self.r["recipe_id"],"version":"v1",**extra}

    def archive_receipt(self,key="old/v1/video"):
        source=self.root/"bytes";source.write_bytes(b"original video bytes")
        return self.archive.save(key,source,{"test_fixture":True})

    def approved(self):
        c=command("trial",self.params(languages=["hu"]))
        result=self.state.apply(c)
        j=claim(self.state,time.time());commit(self.state,j,phase="preview")
        j=claim(self.state,time.time());commit(self.state,j,language="hu",preview={"ok":True})
        j=claim(self.state,time.time());commit(self.state,j,phase="render")
        j=claim(self.state,time.time());receipt=self.archive_receipt(j["items"][0]["output_key"])
        commit(self.state,j,language="hu",receipt=receipt)
        return {"approval_id":str(uuid.uuid4()),"recipe_sha256":digest(self.r),"trial_receipt_sha256":digest(receipt),"approved_at":int(time.time()),"owner_authorized":True}

    def test_zone_concrete_values(self): self.assertEqual(SAFE_ZONE,{"left":65,"right":950,"top":231,"bottom":1459})

    def test_outside_bottom_1802_rejected(self):
        with self.assertRaises(FactoryError) as cm: check_layout([{"frame":0,"scene":"cta","boxes":[{"left":100,"right":900,"top":1300,"bottom":1802}],"forbidden":[]}],SAFE_ZONE,[0])
        self.assertEqual(cm.exception.result["code"],"outside_safe_zone")

    def test_inside_zone_passes(self): self.assertEqual(check_layout([{"frame":0,"scene":"cta","boxes":[{"left":65,"right":950,"top":231,"bottom":1459}],"forbidden":[]}],SAFE_ZONE,[0])["frames_checked"],1)

    def test_forbidden_overlap_fails(self):
        with self.assertRaisesRegex(FactoryError,"overlaps"):check_layout([{"frame":0,"scene":"feedback","boxes":[{"left":100,"right":200,"top":300,"bottom":400}],"forbidden":[{"left":150,"right":250,"top":350,"bottom":450}]}],SAFE_ZONE,[0])

    def test_every_frame_required(self):
        with self.assertRaisesRegex(FactoryError,"every requested frame"):check_layout([{"frame":0,"scene":"outro","boxes":[]}],SAFE_ZONE,range(2))

    def test_no_name_or_language_allowlist(self):
        r=recipe(("th","he"));r["exam"]["name"]="DELF / new exam"
        self.assertEqual(validate_recipe(r)["languages"],["th","he"])

    def test_missing_field_named(self):
        r=recipe();del r["exam"]["score_scale"]
        with self.assertRaises(FactoryError) as cm:validate_recipe(r)
        self.assertEqual(cm.exception.result["field"],"exam.score_scale")

    def test_legacy_universal_version_not_mixable(self):
        with self.assertRaises(ValueError):validate_command(command("register_recipe",{"schema_version":1}))

    def test_preview_is_queued_not_archive_lookup(self):
        out=self.state.apply(command("preview",self.params(languages=["de"])))
        self.assertEqual(out["phase"],"preflight");self.assertEqual(out["languages"][0]["status"],"pending")

    def test_preview_completion_without_final_video(self):
        self.state.apply(command("preview",self.params(languages=["de"])))
        j=claim(self.state,time.time());commit(self.state,j,phase="preview")
        j=claim(self.state,time.time());commit(self.state,j,language="de",preview={"ok":True})
        self.assertIsNone(claim(self.state,time.time()))
        with self.state.transaction() as db:self.assertEqual(db.execute("SELECT count(*) FROM universal_outputs").fetchone()[0],0)

    def test_series_requires_real_trial(self):
        approval={"approval_id":str(uuid.uuid4()),"recipe_sha256":digest(self.r),"trial_receipt_sha256":"0"*64,"approved_at":int(time.time()),"owner_authorized":True}
        with self.assertRaisesRegex(FactoryError,"verified trial"):self.state.apply(command("series_run",self.params(languages=["de"],approval=approval)))

    def test_completed_language_skipped(self):
        approval=self.approved();result=self.state.apply(command("series_run",self.params(languages=["hu","de"],approval=approval)))
        self.assertEqual([r["status"] for r in result["languages"]],["skipped","pending"])

    def test_default_series_requests_27(self):
        approval=self.approved();result=self.state.apply(command("series_run",self.params(approval=approval)))
        self.assertEqual(len(result["languages"]),27)

    def test_rerender_new_path_old_bytes_unchanged(self):
        approval=self.approved()
        with self.state.transaction() as db:old=json.loads(db.execute("SELECT receipt FROM universal_outputs").fetchone()[0])
        result=self.state.apply(command("rerender",self.params(languages=["hu"],rerender=["hu"],approval=approval)))
        self.assertNotEqual(result["languages"][0]["output_key"],old["object_key"])
        self.assertIn("_v",result["languages"][0]["output_key"])
        self.assertTrue(self.archive.verify(old))
        self.assertEqual(result["languages"][0]["status"],"pending")

    def test_redelivery_same_job(self):
        c=command("preview",self.params(languages=["de"]))
        self.assertEqual(self.state.apply(c),self.state.apply(c))

    def test_legacy_and_universal_share_single_lease(self):
        self.state.apply(command("preview",self.params(languages=["de"])))
        j=claim(self.state,time.time());self.assertIsNotNone(j)
        self.assertIsNone(self.state.claim());self.assertIsNone(claim(self.state,time.time()))

    def test_restart_preserves_preview_checkpoint(self):
        self.state.apply(command("preview",self.params(languages=["de","fi"])))
        j=claim(self.state,time.time());commit(self.state,j,phase="preview")
        j=claim(self.state,time.time());commit(self.state,j,language="de",preview={"ok":True})
        state=State(self.state.path,self.archive);j=claim(state,time.time())
        self.assertEqual(j["items"][0]["status"],"previewed");self.assertEqual(j["items"][1]["status"],"pending")

    def test_missing_audio_report_all_languages_before_render(self):
        self.state.apply(command("preview",self.params(languages=["de","fi"])))
        j=claim(self.state,time.time())
        config={"recipe_root":str(self.root/"recipes")}
        with self.assertRaises(FactoryError) as cm:preflight(config,j)
        self.assertEqual([i["language"] for i in cm.exception.result["missing"]],["de","fi"])
        self.assertIn("audio",cm.exception.result["missing"][0]["missing"])

    def test_fail_event_fields_persisted(self):
        self.state.apply(command("preview",self.params(languages=["de"])))
        j=claim(self.state,time.time());fail(self.state,j,{"stage":"font_load","code":"missing_font","message":"Missing font","log_tail":["font-de"]},True)
        event=self.state.pending()[-1]
        self.assertEqual(event["kind"],"final_error");self.assertEqual(event["result"]["stage"],"font_load");self.assertEqual(event["result"]["code"],"missing_font");self.assertEqual(event["result"]["log_tail"],["font-de"])

    def test_cancel_does_not_delete_archive(self):
        old=self.archive_receipt();c=self.state.apply(command("preview",self.params(languages=["de"])))
        result=self.state.apply(command("cancel",{"job_id":c["id"]}))
        self.assertEqual(result["status"],"cancelled");self.assertTrue(self.archive.verify(old))

    def test_pause_after_current_preview(self):
        c=self.state.apply(command("preview",self.params(languages=["de","fi"])))
        j=claim(self.state,time.time());commit(self.state,j,phase="preview")
        j=claim(self.state,time.time());self.state.apply(command("pause",{"job_id":c["id"]}));commit(self.state,j,language="de",preview={"ok":True})
        self.assertIsNone(claim(self.state,time.time()))
        self.state.apply(command("resume",{"job_id":c["id"]}));self.assertIsNotNone(claim(self.state,time.time()))

    def test_alignment_end_is_length(self):
        result=alignment([{"character":"A","start":1,"end":.5}],2000)
        self.assertEqual((result[0]["start_ms"],result[0]["end_ms"]),(1000,1500))

    def test_brand_normalization(self):
        raw=[{"character":c,"start":i*.1,"end":.1} for i,c in enumerate("Kájló.")]
        self.assertEqual(alignment(raw,1000)[0]["text"],"Kylo.")

    def test_secrets_and_logs_bounded(self):
        lines='\n'.join('secret=hidden https://private.test/?token=x' for _ in range(250))
        result=redact(lines)
        self.assertEqual(len(result),200);self.assertNotIn('hidden','\n'.join(result));self.assertNotIn('private.test','\n'.join(result))

    def test_all_previews_before_final_render(self):
        approval=self.approved();self.state.apply(command("series_run",self.params(languages=["de","fi"],approval=approval)))
        config={}
        with patch('universal_runtime.preflight',return_value={"ok":True}),patch('universal_runtime.render_item',return_value=({"ok":True},None)) as render:
            for _ in range(4):run(config,self.state,self.archive,claim(self.state,time.time()))
            self.assertEqual([call.args[-1] for call in render.call_args_list],["preview","preview"])
        j=claim(self.state,time.time());self.assertEqual(j["phase"],"render")


if __name__=='__main__':unittest.main()