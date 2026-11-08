import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
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