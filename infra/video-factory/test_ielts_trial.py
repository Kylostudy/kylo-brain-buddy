import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('prepare_trial', Path(__file__).with_name('prepare-ielts-trial.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TrialTests(unittest.TestCase):
    def test_archive_traversal_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('../outside', b'x')
        with zipfile.ZipFile(buf) as z:
            with self.assertRaisesRegex(ValueError, 'unsafe_member'):
                module.verify_members(z)

    def test_only_czech_one_video_allowed(self):
        for languages, videos in [(['cs', 'de'], [{}]), (['cs'], [{}, {}])]:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as z:
                z.writestr('source/manifest.json', json.dumps({'recipe_id': 'ielts-cs-trial', 'version': 'v1', 'languages': languages, 'videos': videos}))
            with zipfile.ZipFile(buf) as z:
                with self.assertRaisesRegex(ValueError, 'single_czech_trial_required'):
                    module.verify_members(z)

    def test_existing_recipe_never_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'audio'
            module.exclusive_file(target, b'original')
            with self.assertRaisesRegex(ValueError, 'existing_recipe_conflict'):
                module.exclusive_file(target, b'changed')
            self.assertEqual(target.read_bytes(), b'original')

    def test_symlink_parent_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            link = Path(root) / 'link'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlink_destination'):
                module.exclusive_file(link / 'outside', b'blocked')
            self.assertFalse((Path(root) / 'outside').exists())