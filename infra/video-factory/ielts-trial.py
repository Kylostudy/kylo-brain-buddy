#!/usr/bin/env python3
"""Explicit local single-trial entry; never claims a remote command or series."""
import fcntl
import json
import os
import shutil
from pathlib import Path
import time
import uuid
from agent import Runner
from client import Client
from state import State


CORRECTION = 'exact-duration-v1'
ERROR_CODES = {'low_disk', 'archive_conflict', 'media_checksum_failed', 'renderer_review_required', 'archive_readback_failed', 'unsafe_render_output', 'render_or_verification_failed', 'lease_expired'}


def last_error(state, job_id):
    with state.transaction() as db:
        for row in db.execute("SELECT body FROM outbox ORDER BY rowid DESC LIMIT 200"):
            body = json.loads(row['body'])
            if body.get('kind') == 'final_error' and body.get('entity_id') == job_id:
                code = body.get('result', {}).get('code')
                return code if code in ERROR_CODES else 'unknown'
    return None


def retry_failed_trial(state, config):
    """One retry per correction version; only the job's own unverified scratch is discarded."""
    with state.transaction() as db:
        row = db.execute("SELECT id,status,attempts FROM jobs WHERE recipe='ielts-cs-trial' AND version='v1' AND mode='trial'").fetchone()
        done = db.execute("SELECT 1 FROM outputs WHERE video_id LIKE 'ielts-cs-trial/%'").fetchone()
    if not row or done or row['status'] not in ('failed', 'blocked') or row['attempts'] >= 3:
        return False
    delivery = str(uuid.uuid5(uuid.NAMESPACE_URL, 'kylo-cs-trial-v1-retry-' + CORRECTION))
    with state.transaction() as db:
        if db.execute("SELECT 1 FROM commands WHERE id=?", (delivery,)).fetchone():
            return False
    work_root = Path(config['work_root']).resolve()
    scratch = (work_root / row['id']).resolve()
    if scratch.parent != work_root or scratch.is_symlink():
        raise RuntimeError('unsafe_scratch')
    if scratch.exists():
        shutil.rmtree(scratch)
    state.apply({'schema_version': 1, 'delivery_id': delivery, 'operation': 'retry', 'payload': {'job_id': row['id']}})
    print('IELTS trial retry queued: ' + CORRECTION, flush=True)
    return True


def main():
    config = json.loads(Path('/etc/kylo-video-factory/ielts-trial.json').read_text())
    state = State(Path(config['work_root']) / 'state.sqlite3')
    with open(Path(config['work_root']) / 'manager.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads(Path('/etc/kylo-video-factory/ielts-manifest.json').read_text())
        if manifest['recipe_id'] != 'ielts-cs-trial' or manifest['languages'] != ['cs'] or len(manifest['videos']) != 1:
            raise RuntimeError('single_czech_trial_required')
        with state.transaction() as db:
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','rendering','paused') AND recipe != 'ielts-cs-trial'").fetchone():
                raise RuntimeError('existing_jobs_preserved')
        for op, payload in [('register_recipe', manifest), ('trial', {'recipe_id': 'ielts-cs-trial', 'version': 'v1'})]:
            result = state.apply({'schema_version': 1, 'delivery_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'kylo-cs-trial-v1-' + op)), 'operation': op, 'payload': payload})
        retry_failed_trial(state, config)
        runner = Runner(config, state)
        runner.run_one()
        with state.transaction() as db:
            row = db.execute("SELECT id,status,cursor,attempts,trial_receipt FROM jobs WHERE recipe='ielts-cs-trial' AND version='v1' AND mode='trial'").fetchone()
            status = dict(row)
        status['last_error'] = last_error(state, status['id'])
        receipt = json.loads(status.pop('trial_receipt')) if status.get('trial_receipt') else None
        status['receipt'] = receipt
        status['observed_at'] = int(time.time())
        target = Path('/var/lib/kylo-video-factory/ielts-trial-status.json')
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(status))
        os.replace(temp, target)
        print(json.dumps(status), flush=True)
        try:
            client = Client(config['kylogic_origin'], config['agent_id'], Path('/etc/kylo-video-factory/machine-secret').read_text().strip())
            for event in state.pending():
                ack = client.request('events', event)
                if ack.get('acknowledged_event_id') == event['event_id']:
                    state.acknowledge(event['event_id'])
            client.request('heartbeat', {'schema_version': 1, 'agent_id': config['agent_id'], 'takeover_approved': True, 'pending_events': len(state.pending()), 'trial_status': status})
            print('IELTS trial report delivered', flush=True)
        except Exception:
            print('IELTS trial report pending; durable events preserved', flush=True)
        if status['status'] != 'completed':
            raise RuntimeError('trial_not_completed')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('IELTS trial stopped; inspect protected diagnostics', flush=True)
        raise SystemExit(1)