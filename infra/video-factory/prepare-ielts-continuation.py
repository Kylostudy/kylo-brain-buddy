#!/usr/bin/env python3
"""Root-reviewed IELTS continuation handoff.

Archives the 4 finished videos (EN, RO, HR, EL) with no-overwrite semantics and
stages the 11 recovered voice tracks + history JSONs as verified recipe inputs.
Never renders, never starts a series, never overwrites any existing file.
Manufacturing may only begin when KyLogic sends an explicit continuation recipe
for exactly the 11 missing languages (enforced in contract.py).
"""
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

ARCHIVE_SHA = '4e3b02b1a018333f4eb10759fdc7b6520b37cef98b8b023b2ae8efe7379eceab'
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
MISSING = {'ar', 'da', 'hi', 'ja', 'ko', 'ru', 'sk', 'sl', 'sr', 'sv', 'tr'}
ARCHIVE_ONLY = {'en', 'ro', 'hr', 'el'}
TRIAL_RECEIPT_SHA = '6bf82fb5b30e9a53dee81ca1ce174271608d8bccce9948c3cdcea81fcf6eb1f5'


def verify_members(archive):
    names = [item.filename for item in archive.infolist()]
    if len(names) != len(set(names)):
        raise ValueError('duplicate_member')
    for item in archive.infolist():
        p = Path(item.filename)
        if p.is_absolute() or '..' in p.parts or '.git' in p.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('unsafe_member')
    recovered = json.loads(archive.read('recovered-assets.json'))
    if set(recovered['missing_languages']) != MISSING:
        raise ValueError('missing_languages_mismatch')
    if set(recovered['existing_outputs_to_archive_only']) != ARCHIVE_ONLY:
        raise ValueError('archive_only_mismatch')
    if set(recovered['completed_languages_do_not_render']) != (set('en de nl fr es pt it pl no cs fi el hu ro hr zh'.split())):
        raise ValueError('completed_languages_mismatch')
    receipt = recovered['trial_receipt']
    if receipt.get('sha256') != TRIAL_RECEIPT_SHA or receipt.get('object_key') != 'ielts-cs-trial/v1/ielts-cs':
        raise ValueError('trial_receipt_mismatch')
    by_lang = {entry['language']: entry for entry in recovered['languages']}
    if set(by_lang) != MISSING:
        raise ValueError('voice_inventory_mismatch')
    for lang, entry in by_lang.items():
        data = archive.read('vo-' + lang + '.mp3')
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('voice_checksum_failed')
        history = json.loads(archive.read(lang + '-history.json'))
        if history.get('text') != entry['text']:
            raise ValueError('history_text_mismatch')
    return recovered


def exclusive_file(target, data):
    for parent in [target.parent, *target.parents]:
        if parent.is_symlink():
            raise ValueError('symlink_destination')
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
            raise ValueError('existing_input_conflict')
    os.chmod(target, 0o644)


def archive_finished_videos(archive, config, release):
    """Archive-only: verify full decode, then no-overwrite publish. Never re-render."""
    sys.path.insert(0, str(release))
    from storage import LocalArchive
    from verify import verify_video
    store = LocalArchive(config['archive_root'])
    receipts = {}
    scratch = Path(config['work_root']) / 'ielts-continuation-staging'
    if scratch.is_symlink() or (scratch.exists() and not scratch.is_dir()):
        raise RuntimeError('unsafe_scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        for lang in sorted(ARCHIVE_ONLY):
            member = 'existing-complete/kylo-ielts-' + lang + '-9x16.mp4'
            data = archive.read(member)
            temp = scratch / (lang + '.mp4')
            if temp.exists() or temp.is_symlink():
                raise RuntimeError('unsafe_scratch')
            with temp.open('xb') as f:
                f.write(data)
            probe = subprocess.run(['/usr/bin/ffprobe', '-v', 'error', '-show_format', '-of', 'json', str(temp)],
                                   check=True, capture_output=True, timeout=30)
            duration_ms = round(float(json.loads(probe.stdout)['format']['duration']) * 1000)
            media = verify_video(temp, {'width': 1080, 'height': 1920, 'duration_ms': duration_ms})
            receipt = store.save('ielts-continuation/v1/' + lang, temp, media)
            receipts[lang] = receipt
            temp.unlink()
            print('archived existing video: ' + lang, flush=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return receipts


def main():
    if os.geteuid() != 0:
        raise RuntimeError('root_required')
    source = Path(sys.argv[1]).resolve()
    release = Path('/opt/kylo-video-factory/releases') / sys.argv[2]
    with open('/run/lock/kylo-ielts-continuation-install.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('kylo-subject-factory.service', 'kylo-video-factory.service', 'kylo-ielts-trial.service'):
            if subprocess.run(['systemctl', 'is-active', '--quiet', name], check=False).returncode == 0:
                raise RuntimeError('active_producer_preserved')
        config = json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
        for root in (config['work_root'], config['archive_root']):
            usage = shutil.disk_usage(root)
            if usage.free < config['min_free_bytes'] or usage.used / usage.total > config['max_disk_fraction']:
                raise RuntimeError('low_disk')
        status_file = Path('/var/lib/kylo-video-factory/ielts-continuation-status.json')
        if status_file.exists() and json.loads(status_file.read_text()).get('status') == 'prepared':
            print('IELTS continuation already prepared; no repeat', flush=True)
            return
        pointer = json.loads((source / 'ielts-continuation.asset.json').read_text())
        url = 'https://brain.kylosystems.com' + pointer['url']

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        req = urllib.request.Request(url, headers={'User-Agent': 'kylo-ielts-continuation/1.0'})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=300) as response:
            data = response.read(MAX_PACKAGE_BYTES + 1)
        if len(data) > MAX_PACKAGE_BYTES or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA:
            raise RuntimeError('archive_checksum_failed')
        package = Path('/var/lib/kylo-video-factory/ielts-continuation-v1.zip')
        exclusive_file(package, data)
        with zipfile.ZipFile(package) as archive:
            recovered = verify_members(archive)
            receipts = archive_finished_videos(archive, config, release)
            root = Path(config['recipe_root']) / 'ielts-continuation/v1'
            for lang in sorted(MISSING):
                exclusive_file(root / ('vo-' + lang + '.mp3'), archive.read('vo-' + lang + '.mp3'))
                exclusive_file(root / (lang + '-history.json'), archive.read(lang + '-history.json'))
            exclusive_file(root / 'recovered-assets.json', archive.read('recovered-assets.json'))
            for directory in [root, *[p for p in root.rglob('*') if p.is_dir()]]:
                os.chmod(directory, 0o755)
        status = {'status': 'prepared', 'archived_receipts': receipts,
                  'staged_languages': sorted(MISSING), 'observed_at': int(__import__('time').time())}
        temp = status_file.with_suffix('.tmp')
        temp.write_text(json.dumps(status))
        os.chmod(temp, 0o600)
        os.replace(temp, status_file)
        print('IELTS continuation prepared: 4 videos archived, 11 voices staged; manufacturing waits for explicit KyLogic task', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('IELTS continuation preparation failed; existing producers and archives preserved', flush=True)
        raise SystemExit(1)
