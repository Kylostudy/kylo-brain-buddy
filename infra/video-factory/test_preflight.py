"""Shared preflight v1 tests. Inert: no recipe registration, TTS, render, install or network."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid

import preflight
from contract import digest
from preflight import PreflightError, Store

HERE = Path(__file__).resolve().parent
IMAGE = "sha256:842e212260ce75ee4e6cbbefe685e756110a012c72f69336d7ff11f1dd1ec8b7"
SCENE_FRAMES_BYTES = b'{"sceneFrames":[99,218,88,193,59,162,90]}'  # byte-exact, matches the real 41-byte input hash
BOUNDARIES = [0, 3300, 10567, 13500, 19933, 21900, 27300, 30300]
SUBS = [(0, 3297, "One subscription for your notes. Another one for practice."),
        (3471, 6339, "Then comes thesis prep, language practice, and a few more"),
        (6397, 10554, "learning tools. Every month, they can cost over a hundred dollars."),
        (10797, 13503, "But why should you handle everything in separate places?"),
        (14315, 17682, "Kylo. From your notes: explanations, flashcards, and"),
        (17729, 19923, "exam practice. All in one place."),
        (20167, 21897, "For twenty-nine ninety-nine a month."),
        (22048, 24288, "Try it free for 14 days!")]
ORIGINAL_ENDS = [3297, 10554, 13503, 19923, 21897, 27288, 30288]
REAL_FILES = [
    {"bytes": 12164, "key": "audio/coins-mp3", "sha256": "2320df05d53ad9bb07fd59bfdedeecba48955ee020d57e715501bc8b1e27e027"},
    {"bytes": 389581, "key": "audio/vo-en-mp3", "sha256": "5e487939c51aac90b20fd5f7f5fd58567b026e5db687ff66f7f508fb7ef13f9e"},
    {"bytes": 41, "key": "data/scene-frames-en-json", "sha256": "1e89d73abee1cdacb7acc4c3a45fe8e5ecb496e456761d4676cafa648f71c54e"},
]
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def original_recipe():
    """The real, rejected malacpersely-i18n-en-trial/v1 recipe (no credentials or URLs)."""
    text = {"heading": "How much does your learning cost every month?",
            "disclaimer": "Illustrative subscription basket. Actual prices may vary.",
            "truth": "Over 100 USD/month", "price": "29.99 USD/month",
            "steps": ["Class notes", "Explanation", "Flashcards", "Practice exam questions"],
            "counter_values": [20, 35, 55, 80, 105],
            "labels": ["Note-taking", "Flashcards & quizzes", "Thesis prep", "Language & exam practice", "More learning tools"],
            "outro_url": "kylo.study", "outro_tagline": "Your AI tutor"}
    starts = [0] + ORIGINAL_ENDS[:-1]
    return {"files": copy.deepcopy(REAL_FILES), "languages": ["en"], "recipe_id": "malacpersely-i18n-en-trial",
            "renderer": "piggy-bank-multilang-safe-v1", "schema_version": 1, "series": "other", "version": "v1",
            "videos": [{"audio": "audio/vo-en-mp3",
                        "cta": json.dumps({"text": "Try it for free!", "supporting_text": "14-day free trial", "trial_days": 14}),
                        "duration_ms": 30288, "height": 1920, "language": "en", "master": "data/scene-frames-en-json",
                        "scene": "piggy-bank-i18n-v1",
                        "subtitle": json.dumps({"subs": [{"start_ms": a, "end_ms": b, "text": t} for a, b, t in SUBS]}),
                        "text": json.dumps(text),
                        "timing": [{"end_ms": e, "start_ms": s} for s, e in zip(starts, ORIGINAL_ENDS)],
                        "video_id": "malacpersely-en", "width": 1080}]}


def corrected_recipe():
    r = original_recipe()
    v = r["videos"][0]
    text = json.loads(v["text"])
    text.update({"unit": "USD/mo.", "disclaimer": "Illustrative subscription basket. Actual fees may vary.",
                 "truth": "Over 100 USD/mo.", "price": "29.99 USD/mo."})
    v["text"] = json.dumps(text)
    v["timing"] = [{"start_ms": a, "end_ms": b} for a, b in zip(BOUNDARIES, BOUNDARIES[1:])]
    v["duration_ms"] = 30300
    return r


def request(manifest, **over):
    req = {"protocol": preflight.PROTOCOL, "protocol_version": 1, "request_id": str(uuid.uuid4()),
           "owner_id": "kylo-owner", "agent_id": "factory-finnish-vps-1",
           "recipe": {"recipe_id": manifest["recipe_id"], "version": manifest["version"], "sha256": digest(manifest)},
           "manifest": manifest,
           "contract": {"id": preflight.CONTRACT_ID, "version": 1, "sha256": preflight.contract_document()["contract_sha256"]},
           "inputs": copy.deepcopy(manifest["files"]), "expected_image": IMAGE, "requested_at": 1},
    req = req[0]
    req.update(over)
    return req


def stage(root, request_id, files):
    for key, data in files.items():
        path = Path(root) / request_id / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def renderer_config(root, image=IMAGE):
    entry = {"image": image, "reviewed": True, "scenes": ["piggy-bank-i18n-v1"]}
    (Path(root) / "config.json").write_text(json.dumps({"renderers": {"piggy-bank-multilang-safe-v1": entry}}))
    (Path(root) / "reviewed-renderers.json").write_text(json.dumps({"piggy-bank-multilang-safe-v1": entry}))
    return str(Path(root) / "config.json"), str(Path(root) / "reviewed-renderers.json")


def tone(path, seconds):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=%s" % seconds,
                    "-c:a", "libmp3lame", "-b:a", "64k", str(path)], check=True)
    return Path(path).read_bytes()


class Env:
    """Temp preflight root with staging and renderer config; records every subprocess call."""
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(self.root / "preflight")
        self.config = renderer_config(self.root)
        self.calls = []

    def runner(self, args, **kw):
        self.calls.append(list(args))
        return subprocess.run(args, **kw)

    def run(self, req, image=IMAGE, now=None):
        return self.store.check(req, lambda: preflight.run_check(req, self.store.staging_root(), *self.config, now=now,
                                                                 inspect=lambda _: image, runner=self.runner))


class ContractExportTests(unittest.TestCase):
    def test_contract_is_generated_from_installed_validator_and_deterministic(self):
        a, b = preflight.contract_document(), preflight.contract_document()
        self.assertEqual(a, b)
        body = {k: v for k, v in a.items() if k != "contract_sha256"}
        self.assertEqual(a["contract_sha256"], digest(body))
        self.assertEqual(a["generated_from"]["validator_sha256"], {
            "contract.py": "509bd75ce42b1892cf4a1c177afa1e3c807a9fbafd3d453f735fb2583fb692c6",
            "piggy.py": "8f3d438f1bc7dbd687d996516c94fe1aa56ada484a1a295b4c745240356da033",
            "piggy_i18n.py": "5269e95ad92711c8bd76d088d97e845d5e3fcf9d609462312a7811f34be3e004"})
        self.assertEqual(a["translations"]["en"]["unit"], "USD/mo.")
        self.assertEqual(a["recipes"]["malacpersely-i18n-en-trial"]["forbidden_operations"], ["start_series", "series_run", "rerender"])

    def test_renderer_image_validator_copy_is_identical(self):
        self.assertEqual(preflight.validator_hashes(), preflight.validator_hashes(HERE / "piggy-multilang-renderer/validation"))

    def test_pinned_renderer_rule_sources_match(self):
        for rel, sha in preflight.RENDERER_SOURCES.items():
            self.assertEqual(preflight.file_sha(HERE / rel), sha, rel)

    def test_real_scene_frames_input_is_byte_exact(self):
        self.assertEqual(hashlib.sha256(SCENE_FRAMES_BYTES).hexdigest(), REAL_FILES[2]["sha256"])
        self.assertEqual(len(SCENE_FRAMES_BYTES), 41)
        self.assertEqual(preflight.boundaries([99, 218, 88, 193, 59, 162, 90]), BOUNDARIES)
        self.assertEqual(preflight.coin_hits([99, 218, 88, 193, 59, 162, 90]), [58, 121, 164, 208, 252])


class RecipeTests(unittest.TestCase):
    def test_original_reports_all_known_deviations_in_one_result(self):
        result = preflight.check_recipe(original_recipe(), {"en": [99, 218, 88, 193, 59, 162, 90]})
        self.assertEqual(result["authoritative"], "piggy_unsupported_fields")
        found = {(i["path"], i["code"]) for i in result["issues"]}
        self.assertIn(("$.videos[0].text", "piggy_unsupported_fields"), found)
        exp = {i["path"]: i.get("expected") for i in result["issues"]}
        self.assertEqual(exp["$.videos[0].text.unit"], "USD/mo.")
        self.assertEqual(exp["$.videos[0].text.disclaimer"], "Illustrative subscription basket. Actual fees may vary.")
        self.assertEqual(exp["$.videos[0].text.truth"], "Over 100 USD/mo.")
        self.assertEqual(exp["$.videos[0].text.price"], "29.99 USD/mo.")
        for k, want in enumerate(BOUNDARIES[1:]):
            self.assertEqual(exp["$.videos[0].timing[%d].end_ms" % k], want)
        self.assertEqual(exp["$.videos[0].duration_ms"], 30300)
        self.assertIn("$.videos[0].subtitle", {s["check"] for s in result["skipped"]})
        self.assertEqual(result["status"], "fail")

    def test_each_reported_deviation_is_real_for_the_authoritative_validator(self):
        from contract import validate_recipe
        r = original_recipe()
        v = r["videos"][0]
        text = json.loads(v["text"])
        text["unit"] = "USD/mo."
        v["text"] = json.dumps(text)
        with self.assertRaisesRegex(ValueError, "piggy_i18n_translation_required"):
            validate_recipe(copy.deepcopy(r))
        r2 = corrected_recipe()
        r2["videos"][0]["timing"] = original_recipe()["videos"][0]["timing"]
        r2["videos"][0]["duration_ms"] = 30288
        with self.assertRaisesRegex(ValueError, "piggy_invalid_timing"):
            validate_recipe(r2)

    def test_corrected_passes_and_subtitle_13503_follows_the_authoritative_bound(self):
        result = preflight.check_recipe(corrected_recipe(), {"en": [99, 218, 88, 193, 59, 162, 90]})
        self.assertEqual((result["status"], result["authoritative"], result["issues"]), ("pass", "accepted", []))
        # Subtitles are bounded only by the end of scene 6 (27300 ms); 13503 > 13500 is not a violation.
        self.assertEqual(json.loads(corrected_recipe()["videos"][0]["subtitle"])["subs"][3]["end_ms"], 13503)

    def test_subtitle_past_scene_six_is_rejected_without_tolerance(self):
        r = corrected_recipe()
        subs = json.loads(r["videos"][0]["subtitle"])
        subs["subs"][-1]["end_ms"] = 27301
        r["videos"][0]["subtitle"] = json.dumps(subs)
        result = preflight.check_recipe(r, {"en": [99, 218, 88, 193, 59, 162, 90]})
        self.assertEqual(result["authoritative"], "piggy_invalid_subtitles")
        self.assertIn("$.videos[0].subtitle.subs[7]", {i["path"] for i in result["issues"]})

    def test_broken_json_skips_dependent_checks(self):
        r = corrected_recipe()
        r["videos"][0]["text"] = "{not json"
        result = preflight.check_recipe(r)
        self.assertEqual([i["code"] for i in result["issues"] if i["path"].startswith("$.videos[0].text")], ["piggy_invalid_json"])
        self.assertIn("$.videos[0].text.*", {s["check"] for s in result["skipped"]})

    def test_local_and_renderer_validator_copies_give_identical_normalized_result(self):
        with tempfile.TemporaryDirectory() as temp:
            copy_root = Path(temp) / "v"
            shutil.copytree(HERE / "piggy-multilang-renderer/validation", copy_root)
            for name in ("universal.py", "universal_state.py", "universal_runtime.py", "universal_media.py"):
                shutil.copy(HERE / name, copy_root / name)
            script = ("import json,sys;sys.path.insert(0,%r);sys.path.append(%r);import preflight,test_preflight as t;"
                      "print(json.dumps([preflight.check_recipe(f(),{'en':[99,218,88,193,59,162,90]},%r) for f in (t.original_recipe,t.corrected_recipe)],sort_keys=True))")
            outs = [subprocess.run(["python3", "-B", "-c", script % (str(root), str(HERE), str(root))], capture_output=True, text=True,
                                   check=True, cwd=str(HERE)).stdout for root in (HERE, copy_root)]
            self.assertEqual(outs[0], outs[1])


class RequestBindingTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.temp.cleanup()

    def test_unknown_or_different_contract_stops_before_any_check(self):
        req = request(corrected_recipe())
        req["contract"] = dict(req["contract"], sha256="0" * 64)
        with self.assertRaises(PreflightError) as caught:
            self.env.run(req)
        self.assertEqual(caught.exception.code, "preflight_contract_mismatch")
        req["contract"] = dict(req["contract"], version=2)
        with self.assertRaises(PreflightError) as caught:
            self.env.run(req)
        self.assertEqual(caught.exception.code, "preflight_contract_unknown")
        self.assertEqual(self.env.calls, [])

    def test_different_inputs_and_recipe_hash_are_rejected(self):
        req = request(corrected_recipe())
        req["inputs"][0] = dict(req["inputs"][0], sha256="1" * 64)
        with self.assertRaisesRegex(PreflightError, "preflight_input_binding_mismatch"):
            self.env.run(req)
        req = request(corrected_recipe())
        req["recipe"] = dict(req["recipe"], sha256="2" * 64)
        with self.assertRaisesRegex(PreflightError, "preflight_recipe_hash_mismatch"):
            self.env.run(req)

    def test_authorization_fields_are_not_accepted_in_a_preflight(self):
        req = request(corrected_recipe())
        req["owner_authorized"] = True
        with self.assertRaisesRegex(PreflightError, "preflight_unsupported_fields"):
            self.env.run(req)

    def test_different_image_blocks(self):
        req = request(corrected_recipe())
        stage(self.env.store.staging_root(), req["request_id"], {"data/scene-frames-en-json": SCENE_FRAMES_BYTES})
        result = self.env.run(req, image="sha256:" + "3" * 64)
        self.assertEqual(result["renderer_check"]["issues"][0]["code"], "preflight_image_mismatch")
        self.assertEqual(result["status"], "blocked")

    def test_original_real_request_one_report_media_incomplete_without_audio(self):
        req = request(original_recipe())
        stage(self.env.store.staging_root(), req["request_id"], {"data/scene-frames-en-json": SCENE_FRAMES_BYTES})
        result = self.env.run(req, now=1_800_000_000)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["recipe_check"]["authoritative"], "piggy_unsupported_fields")
        self.assertEqual(result["media_check"]["status"], "incomplete")
        self.assertEqual(result["media_check"]["facts"]["en"]["boundaries_ms"], BOUNDARIES)
        self.assertEqual(result["authorization"], "not_granted")
        self.assertTrue(all(v is False for v in result["side_effects"].values()))

    def test_repeat_same_payload_returns_original_result_and_time(self):
        req = request(corrected_recipe())
        first = self.env.run(req, now=1_800_000_000)
        again = self.env.run(copy.deepcopy(req), now=1_800_009_999)
        self.assertEqual(first, again)
        self.assertEqual(again["checked_at"], "2027-01-15T08:00:00Z")

    def test_same_id_different_payload_or_agent_is_conflict(self):
        req = request(corrected_recipe())
        self.env.run(req)
        changed = copy.deepcopy(req)
        changed["requested_at"] = 2
        with self.assertRaisesRegex(PreflightError, "preflight_request_conflict"):
            self.env.run(changed)
        other = copy.deepcopy(req)
        other["agent_id"] = "another-agent"
        with self.assertRaisesRegex(PreflightError, "preflight_request_conflict"):
            self.env.run(other)

    def test_ack_binds_full_result_and_agent(self):
        req = request(corrected_recipe())
        result = self.env.run(req)
        with self.assertRaisesRegex(PreflightError, "preflight_ack_mismatch"):
            self.env.store.ack(req["request_id"], req["agent_id"], "4" * 64)
        with self.assertRaisesRegex(PreflightError, "preflight_ack_mismatch"):
            self.env.store.ack(req["request_id"], "other-agent", result["result_sha256"])
        self.assertEqual(len(self.env.store.pending_results()), 1)
        self.assertTrue(self.env.store.ack(req["request_id"], req["agent_id"], result["result_sha256"]))
        self.assertEqual(self.env.store.pending_results(), [])
        body = {k: v for k, v in result.items() if k != "result_sha256"}
        self.assertEqual(digest(body), result["result_sha256"])


class PathAndStagingTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.temp.cleanup()

    def test_absolute_and_traversal_keys_are_rejected(self):
        r = corrected_recipe()
        for bad in ("/etc/passwd", "../x", "audio/../../x", "audio/vo-en.mp3"):
            r2 = copy.deepcopy(r)
            r2["files"][0]["key"] = bad
            result = preflight.check_recipe(r2)
            self.assertEqual(result["status"], "fail")
            self.assertIn("invalid_object_key", {i["code"] for i in result["issues"]})

    def test_symlinked_staging_is_not_followed(self):
        req = request(corrected_recipe())
        outside = self.env.root / "outside.json"
        outside.write_bytes(SCENE_FRAMES_BYTES)
        target = self.env.store.staging_root() / req["request_id"] / "data"
        target.mkdir(parents=True)
        os.symlink(outside, target / "scene-frames-en-json")
        result = self.env.run(req)
        self.assertIn("preflight_unsafe_path", {i["code"] for i in result["media_check"]["issues"]})
        os.unlink(target / "scene-frames-en-json")
        shutil.rmtree(self.env.store.staging_root() / req["request_id"])
        os.symlink(self.env.root, self.env.store.staging_root() / req["request_id"])
        req2 = dict(req, request_id=req["request_id"])
        media, _ = preflight.check_media(req2["manifest"], self.env.store.staging_root(), req["request_id"])
        self.assertTrue(all(i["code"] == "preflight_unsafe_path" for i in media["issues"]) and media["issues"])

    def test_staging_quota_and_expiry(self):
        rid = str(uuid.uuid4())
        with self.assertRaisesRegex(PreflightError, "preflight_staging_quota"):
            self.env.store.reserve_staging(rid, 700 * 1024 * 1024)
        path = self.env.store.reserve_staging(rid, 10)
        (path / "f").write_bytes(b"x")
        self.assertEqual(self.env.store.purge_staging(now=time.time()), [])
        self.assertEqual(self.env.store.purge_staging(now=time.time() + preflight.STAGING_TTL_S + 10), [rid])
        with self.assertRaisesRegex(PreflightError, "preflight_invalid_request_id"):
            self.env.store.reserve_staging("../x", 1)


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg/ffprobe not installed")
class MediaTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.temp.cleanup()

    def synthetic(self, narration_s=24.5, corrupt=False):
        tmp = self.env.root
        vo = tone(tmp / "vo.mp3", narration_s) if not corrupt else b"ID3" + b"\x00" * 4000
        coins = tone(tmp / "coins.mp3", 0.4)
        r = corrected_recipe()
        data = {"audio/coins-mp3": coins, "audio/vo-en-mp3": vo, "data/scene-frames-en-json": SCENE_FRAMES_BYTES}
        r["files"] = [{"key": k, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for k, b in sorted(data.items())]
        req = request(r)
        stage(self.env.store.staging_root(), req["request_id"], data)
        return req

    def test_synthetic_inputs_ready_for_approval_without_side_effects(self):
        req = self.synthetic()
        before = {p: p.read_bytes() for p in (self.env.store.staging_root() / req["request_id"]).rglob("*") if p.is_file()}
        result = self.env.run(req)
        self.assertEqual(result["status"], "ready_for_approval", json.dumps(result["media_check"]))
        self.assertEqual(result["authorization"], "not_granted")
        self.assertEqual({p: p.read_bytes() for p in before}, before)
        self.assertTrue(all(c[0] in {"ffprobe", "ffmpeg"} and "-f" in c and c[-1] in {"-", "json"} or c[0] == "ffprobe" for c in self.env.calls))
        self.assertFalse(any("docker" in c[0] or "run" in c for c in self.env.calls))

    def test_narration_longer_than_scene_six_is_blocked(self):
        result = self.env.run(self.synthetic(narration_s=28.0))
        self.assertIn("piggy_audio_timing_mismatch", {i["code"] for i in result["media_check"]["issues"]})
        self.assertEqual(result["status"], "blocked")

    def test_undecodable_narration_is_blocked(self):
        result = self.env.run(self.synthetic(corrupt=True))
        self.assertIn("preflight_media_undecodable", {i["code"] for i in result["media_check"]["issues"]})

    def test_real_hashes_with_wrong_bytes_are_mismatch(self):
        req = request(corrected_recipe())
        stage(self.env.store.staging_root(), req["request_id"], {"audio/vo-en-mp3": b"x" * 10, "data/scene-frames-en-json": SCENE_FRAMES_BYTES})
        result = self.env.run(req)
        codes = {i["code"] for i in result["media_check"]["issues"]}
        self.assertTrue({"preflight_input_size_mismatch", "preflight_input_checksum_mismatch"} <= codes)


class GateAndSignatureTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.req = request(corrected_recipe())
        self.result = dict(self.env.run(self.req), status="ready_for_approval")
        self.current = {"recipe": self.req["recipe"], "contract": self.req["contract"],
                        "inputs": sorted(self.req["inputs"], key=lambda f: f["key"]), "image": IMAGE,
                        "validator_sha256": preflight.validator_hashes()}

    def tearDown(self):
        self.env.temp.cleanup()

    def test_trial_requires_verified_owner_approval_not_a_flag(self):
        for approval in (False, None, "true", {"owner_authorized": True}):
            with self.assertRaisesRegex(PreflightError, "owner_approval_required"):
                preflight.production_gate("trial", self.result, self.current, approval)
        self.assertTrue(preflight.production_gate("trial", self.result, self.current, True))

    def test_series_never_allowed_for_en_trial(self):
        with self.assertRaisesRegex(PreflightError, "trial_only_recipe"):
            preflight.production_gate("start_series", self.result, self.current, True)

    def test_recipe_change_or_expiry_invalidates(self):
        changed = dict(self.current, recipe=dict(self.current["recipe"], sha256="5" * 64))
        with self.assertRaisesRegex(PreflightError, "preflight_binding_changed"):
            preflight.production_gate("trial", self.result, changed, True)
        with self.assertRaisesRegex(PreflightError, "preflight_result_expired"):
            preflight.production_gate("trial", self.result, self.current, True, now=int(time.time()) + preflight.RESULT_TTL_S + 60)
        with self.assertRaisesRegex(PreflightError, "preflight_not_ready"):
            preflight.production_gate("trial", dict(self.result, status="blocked"), self.current, True)

    def test_signature_namespace_and_nonce_replay(self):
        from client import signature
        secret, body, stamp = "s" * 40, b"{}", str(int(time.time()))
        sig = preflight.sign(secret, stamp, "n1", "POST", "result", body)
        self.assertNotEqual(sig, signature(secret, stamp, "n1", "POST", "/api/public/video-factory/v1/events", body))
        headers = {"X-Factory-Timestamp": stamp, "X-Factory-Nonce": "n1", "X-Factory-Signature": sig}
        self.assertTrue(preflight.verify_signature(secret, self.env.store, headers, "POST", "result", body))
        with self.assertRaisesRegex(PreflightError, "preflight_nonce_replay"):
            preflight.verify_signature(secret, self.env.store, headers, "POST", "result", body)
        with self.assertRaisesRegex(PreflightError, "preflight_signature_invalid"):
            preflight.verify_signature(secret, self.env.store, dict(headers, **{"X-Factory-Nonce": "n2"}), "POST", "claim", body)
        with self.assertRaisesRegex(PreflightError, "preflight_operation_not_allowed"):
            preflight.sign(secret, stamp, "n3", "POST", "events", body)


if __name__ == "__main__":
    unittest.main()
