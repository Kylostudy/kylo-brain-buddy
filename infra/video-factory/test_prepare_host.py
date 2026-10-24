"""No package installation: test the host prerequisite policy with fake tools."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest


class HostTests(unittest.TestCase):
    def exercise(self, installed):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / 'calls'
            for name in ('id', 'apt-get', *(['ffmpeg', 'ffprobe', 'openssl'] if installed else [])):
                script = root / name
                if name == 'id':
                    script.write_text('#!/bin/bash\necho 0\n')
                elif name == 'apt-get':
                    script.write_text(f'#!/bin/bash\necho "$*" >> "{calls}"\nfor name in ffmpeg ffprobe openssl; do printf "#!/bin/bash\\nexit 0\\n" > "{root}/$name"; /bin/chmod +x "{root}/$name"; done\n')
                else:
                    script.write_text('#!/bin/bash\nexit 0\n')
                script.chmod(0o755)
            result = subprocess.run(['/bin/bash', str(Path(__file__).with_name('prepare-host.sh'))],
                env={**os.environ, 'PATH': str(root)}, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            return calls.read_text() if calls.exists() else ''

    def test_installed_tools_do_not_change_host_packages(self):
        self.assertEqual(self.exercise(True), '')

    def test_missing_tools_install_only_fixed_dependencies(self):
        calls = self.exercise(False).splitlines()
        self.assertEqual(calls, ['-o DPkg::Lock::Timeout=60 update -qq',
            '-o DPkg::Lock::Timeout=60 install -y --no-install-recommends ffmpeg openssl'])