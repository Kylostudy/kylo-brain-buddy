#!/usr/bin/env python3
"""Root-reviewed bounded handoff. Only recipe media are extracted from upload."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ARCHIVE_SHA = '17fa4917d8c6a846e4402fd53c1ca5684b82373979dafca4c4d5b9b4157c5f9e'


def verify_members(archive):
    for item in archive.infolist():
        p = Path(item.filename)
        if p.is_absolute() or '..' in p.parts or '.git' in p.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('unsafe_member')
    manifest = json.loads(archive.read('source/manifest.json'))
    if manifest['recipe_id'] != 'ielts-cs-trial' or manifest['version'] != 'v1' or manifest['languages'] != ['cs'] or len(manifest['videos']) != 1:
        raise ValueError('single_czech_trial_required')
    for entry in manifest['files']:
        data = archive.read('recipe/' + entry['key'])
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('recipe_checksum_failed')
    return manifest


def exclusive_file(target, data):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        raise ValueError('symlink_destination')
    try:
        with target.open('xb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        if target.read_bytes() != data:
            raise ValueError('existing_recipe_conflict')
    os.chmod(target, 0o644)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('root_required')
    source = Path(sys.argv[1]).resolve()
    release = Path('/opt/kylo-video-factory/releases') / sys.argv[2]
    with open('/run/lock/kylo-ielts-trial-install.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('kylo-subject-factory.service', 'kylo-video-factory.service', 'kylo-ielts-trial.service'):
            if subprocess.run(['systemctl', 'is-active', '--quiet', name], check=False).returncode == 0:
                raise RuntimeError('active_producer_preserved')
        inspect = subprocess.run(['docker', 'ps', '--format', '{{.Names}}'], check=True, capture_output=True, text=True)
        if any(name in inspect.stdout.splitlines() for name in ('kylo-subject-factory', 'kylo-video-factory-render')):
            raise RuntimeError('active_container_preserved')
        config = json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
        for root in (config['work_root'], '/var/brain/archive'):
            usage = shutil.disk_usage(root)
            if usage.free < config['min_free_bytes'] or usage.used / usage.total > config['max_disk_fraction']:
                raise RuntimeError('low_disk')
        receipt_file = Path('/var/lib/kylo-video-factory/ielts-trial-status.json')
        if receipt_file.exists() and json.loads(receipt_file.read_text()).get('status') == 'completed':
            print('IELTS trial already completed; no regeneration', flush=True)
            return
        pointer = json.loads((source / 'ielts-cs-trial.asset.json').read_text())
        url = 'https://brain.kylosystems.com' + pointer['url']
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        req = urllib.request.Request(url, headers={'User-Agent': 'kylo-ielts-trial/1.0'})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=120) as response:
            data = response.read(4 * 1024 * 1024 + 1)
        if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA:
            raise RuntimeError('archive_checksum_failed')
        package = Path('/var/lib/kylo-video-factory/ielts-cs-trial-v1.zip')
        exclusive_file(package, data)
        sys.path.insert(0, str(release))
        from contract import validate_recipe
        with zipfile.ZipFile(package) as archive:
            manifest = verify_members(archive)
            validate_recipe(manifest)
            root = Path(config['recipe_root']) / 'ielts-cs-trial/v1'
            for entry in manifest['files']:
                exclusive_file(root / entry['key'], archive.read('recipe/' + entry['key']))
            for directory in [root, *[p for p in root.rglob('*') if p.is_dir()]]:
                os.chmod(directory, 0o755)
        print('IELTS Czech recipe media verified', flush=True)
        subprocess.run(['docker', 'build', '--tag', 'kylo-ielts-promo:reviewed-v1', str(source / 'ielts-renderer')], check=True, timeout=1800)
        image = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'kylo-ielts-promo:reviewed-v1'], text=True).strip()
        if not image.startswith('sha256:'):
            raise RuntimeError('immutable_image_required')
        config['takeover_approved'] = True
        config['renderers'] = {'ielts-promo-v1': {'image': image, 'reviewed': True, 'scenes': ['ielts-promo-v1']}}
        for name, value in [('ielts-trial.json', config), ('ielts-manifest.json', manifest)]:
            target = Path('/etc/kylo-video-factory') / name
            temp = target.with_suffix('.tmp')
            temp.write_text(json.dumps(value))
            os.chmod(temp, 0o600)
            os.replace(temp, target)
        for name in ('ielts-trial.py',):
            shutil.copyfile(source / name, release / name)
        print('IELTS reviewed image ' + image, flush=True)
        subprocess.run(['systemd-run', '--unit=kylo-ielts-trial', '--collect',
            '--property=Type=exec', '--property=Restart=no', '--property=KillMode=process',
            '--property=RuntimeMaxSec=7500', '--property=UMask=0077',
            '--property=Environment=PYTHONDONTWRITEBYTECODE=1',
            '/usr/bin/python3', '-u', str(release / 'ielts-trial.py')], check=True)
        print('IELTS single Czech trial submitted; no series or publishing', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('IELTS preparation failed; existing producers and archives preserved', flush=True)
        raise SystemExit(1)