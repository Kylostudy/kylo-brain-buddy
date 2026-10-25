"""Execute the deploy's continuation/activation shell with isolated host doubles."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parents[2] / "worker/deploy.sh"


class ManagerStartupTests(unittest.TestCase):
    def run_deploy_step(self, *, prepared=False, failure=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            status = root / "status.json"
            events = root / "events"
            if prepared:
                status.write_text('{"status":"prepared"}')
            (root / "prepare-ielts-continuation.py").write_text(
                "import os, time\nfrom pathlib import Path\n"
                "time.sleep(0.2)\n"
                "if os.environ['FAIL'] == '1': raise SystemExit(1)\n"
                "Path(os.environ['STATUS']).write_text('{\"status\":\"prepared\"}')\n"
                "Path(os.environ['EVENTS']).write_text('prepared\\n')\n"
            )
            (root / "activate-manager.sh").write_text(
                '#!/bin/bash\nset -e\n[ -f "$STATUS" ]\n'
                'echo "activated:$1" >> "$EVENTS"\n'
            )
            # Expand the real nested VF_SCRIPT quotes exactly as deploy.sh does.
            text = DEPLOY.read_text()
            assignment = text.split('  VF_SCRIPT="', 1)[1].split('\n"\n  if [', 1)[0]
            continuation = assignment.split("if [ -f '$VF_SRC/prepare-ielts-continuation.py' ]; then", 1)[1]
            continuation = "if [ -f '$VF_SRC/prepare-ielts-continuation.py' ]; then" + continuation
            continuation = continuation.replace(
                "/var/lib/kylo-video-factory/ielts-continuation-status.json", str(status))
            expanded = subprocess.run(
                ["bash", "-c", 'VF_SRC="$1"; VF_VER=test-v12; VF_SCRIPT="' + continuation +
                 '\n"; printf "%s" "$VF_SCRIPT"', "--", str(root)],
                check=True, capture_output=True, text=True,
            ).stdout
            # Mimic systemd-run returning before its background command finishes.
            doubles = '''
systemctl() { return 1; }
systemd-run() {
  while [ "$#" -gt 0 ] && [ "$1" != /bin/bash ]; do shift; done
  "$@" > "$JOB_LOG" 2>&1 &
  JOB_PID=$!
}
'''
            env = {**os.environ, "STATUS": str(status), "EVENTS": str(events),
                   "FAIL": "1" if failure else "0", "JOB_LOG": str(root / "job.log")}
            subprocess.run(["bash", "-c", "set -e\n" + doubles + expanded +
                            '\nif [ -n "${JOB_PID:-}" ]; then\n'
                            '[ ! -f "$EVENTS" ] || exit 99\n'
                            'wait "$JOB_PID" || true\nfi'], env=env, check=True,
                           capture_output=True, text=True, timeout=10)
            return events.read_text().splitlines() if events.exists() else []

    def test_delayed_preparation_activates_without_second_deploy(self):
        self.assertEqual(self.run_deploy_step(), ["prepared", "activated:test-v12"])

    def test_failed_preparation_never_activates(self):
        self.assertEqual(self.run_deploy_step(failure=True), [])

    def test_already_prepared_activates_directly_without_rearchiving(self):
        self.assertEqual(self.run_deploy_step(prepared=True), ["activated:test-v12"])


if __name__ == "__main__":
    unittest.main()