import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch
from state import State

spec = importlib.util.spec_from_file_location("self_check_only", Path(__file__).with_name("self-check-only.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckOnlyTests(unittest.TestCase):
    def test_sends_only_diagnostic_event_and_never_creates_jobs_or_recipes(self):
        with tempfile.TemporaryDirectory() as d:
            state = State(Path(d) / "state.sqlite3")
            client = Mock()
            client.request.side_effect = lambda op, event: {"acknowledged_event_id": event["event_id"]}
            result = module.run({"agent_id": "factory-finnish-vps-1"}, state, client, lambda c: {"ok": True, "checks": [{"ok": True}], "observed_at": "2026-11-08T07:02:00Z"})
            self.assertTrue(result["kylogic_acknowledged"])
            self.assertEqual([c.args[0] for c in client.request.call_args_list], ["events"])
            with state.transaction() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM recipes").fetchone()[0], 0)

    def test_wrong_acknowledgement_preserves_event(self):
        with tempfile.TemporaryDirectory() as d:
            state = State(Path(d) / "state.sqlite3")
            client = Mock()
            client.request.return_value = {"acknowledged_event_id": "different"}
            result = module.run({"agent_id": "factory-finnish-vps-1"}, state, client, lambda c: {"ok": True, "checks": []})
            self.assertFalse(result["kylogic_acknowledged"])
            self.assertEqual(len(state.pending()), 1)

    def test_seven_diagnostic_emits_only_its_own_event_without_trial(self):
        with tempfile.TemporaryDirectory() as d:
            state = State(Path(d) / "state.sqlite3")
            client = Mock()
            client.request.side_effect = lambda op, event: {"acknowledged_event_id": event["event_id"]}
            report = {"contract_id": "kylo-seven-stories-hu-v1", "input_ok": True, "preparation_ok": True, "ok": False, "render_started": False}
            result = module.run({"agent_id": "factory-finnish-vps-1"}, state, client, lambda c: report)
            self.assertTrue(result["kylogic_acknowledged"])
            self.assertEqual([c.args[0] for c in client.request.call_args_list], ["events"])
            with state.transaction() as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM recipes").fetchone()[0], 0)

    def test_seven_cli_readiness_requires_preparation_and_ack_not_production_qa(self):
        config = {"recipe_root": "/recipes", "work_root": "/work", "kylogic_origin": "https://example.invalid", "agent_id": "test-agent"}
        for version, acknowledged, code in (("v1", True, 0), ("v1", False, 3), ("v2", True, 0), ("v2", False, 3)):
            result = {"ok": False, "preparation_ok": True, "kylogic_acknowledged": acknowledged}
            with patch.object(sys, "argv", ["self-check-only.py", "--seven-stories", "--version", version]), \
                    patch.object(Path, "read_text", side_effect=[json.dumps(config), "test-only"]), \
                    patch.object(Path, "stat", return_value=SimpleNamespace(st_mode=0o600)), \
                    patch.object(Path, "write_text"), patch.object(module.os, "chmod"), \
                    patch.object(module.os, "replace") as replace, \
                    patch.object(module, "State"), patch.object(module, "Client"), \
                    patch.object(module, "run", return_value=result) as run, \
                    patch("builtins.print"), patch("seven_preflight.run", return_value=result) as preflight:
                self.assertEqual(module.main(), code)
                checker = run.call_args.args[3]
                self.assertEqual(checker(config), result)
                preflight.assert_called_once_with("/recipes", "/etc/kylo-video-factory/config.json", registered=True, version=version)
                self.assertEqual(str(replace.call_args.args[1]), "/var/lib/kylo-video-factory/seven-stories-preflight.json")