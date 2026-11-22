"""Series gates are separate and default-closed; legacy jobs/receipts remain intact."""
import json
import time
import uuid
import seven_series as series
from contract import canonical,digest
from seven_series_preflight import anchors


def tables(db):
    db.execute('CREATE TABLE IF NOT EXISTS seven_series_checks(event_id TEXT PRIMARY KEY, report TEXT NOT NULL)')


def record(state,report):
    with state.transaction() as db:
        before=db.execute('SELECT COALESCE(MAX(rowid),0) FROM outbox').fetchone()[0]
        state.emit(db,'self_check',series.CONTRACT_ID,report)
        row=db.execute('SELECT id FROM outbox WHERE rowid>? ORDER BY rowid DESC LIMIT 1',(before,)).fetchone()
        db.execute('INSERT INTO seven_series_checks VALUES(?,?)',(row['id'],canonical(report).decode()))
        return row['id']


def check_gate(state,db,manifest,approval,event_id):
    series.validate(manifest)
    row=db.execute('SELECT c.report,o.sent FROM seven_series_checks c JOIN outbox o ON o.id=c.event_id WHERE c.event_id=?',(event_id,)).fetchone()
    if not row or row['sent']!=1: raise ValueError('seven_series_preflight_ack_required')
    report=json.loads(row['report'])
    if report.get('ok') is not True or report.get('contract_sha256')!=digest(series.contract_export()) or len(report.get('recipe_hashes',{}))!=7: raise ValueError('seven_series_preflight_failed')
    for story in series.STORIES:
        registered=db.execute('SELECT hash FROM recipes WHERE id=? AND version=?',(series.recipe_id(story),'v1')).fetchone()
        if not registered or report['recipe_hashes'].get(series.recipe_id(story))!=registered['hash']: raise ValueError('seven_series_preflight_stale')
    trial=anchors(state,db,manifest)
    if approval['recipe_sha256']!=digest(manifest) or approval['trial_receipt_sha256']!=digest(trial): raise ValueError('seven_series_approval_binding')
    if not 0<approval['approved_at']<=int(time.time())+60: raise ValueError('invalid_approval_time')
    return report


def start(state,db,p):
    row=db.execute('SELECT manifest FROM recipes WHERE id=? AND version=?',(p['recipe_id'],p['version'])).fetchone()
    if not row: raise ValueError('recipe_not_registered')
    manifest=json.loads(row['manifest'])
    report=check_gate(state,db,manifest,p['approval'],p['preflight_event_id'])
    db.execute("INSERT OR IGNORE INTO jobs(id,recipe,version,mode,status) VALUES(?,?,?,'series','queued')",(str(uuid.uuid4()),p['recipe_id'],p['version']))
    return dict(db.execute("SELECT id,status FROM jobs WHERE recipe=? AND version=? AND mode='series'",(p['recipe_id'],p['version'])).fetchone())


def before_render(state,job,config):
    """Check current image binding and original archived anchor before every item."""
    manifest=series.validate(job['manifest'])
    from pathlib import Path
    renderer=config['renderers'][series.RENDERER]
    reviewed=json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
    if renderer!=reviewed.get(series.RENDERER) or renderer.get('scenes')!=series.SCENES or renderer.get('reviewed') is not True:
        raise ValueError('seven_series_renderer_binding')
    with state.transaction() as db:
        anchors(state,db,manifest)
        rows=db.execute('SELECT report FROM seven_series_checks c JOIN outbox o ON o.id=c.event_id WHERE o.sent=1 ORDER BY c.rowid DESC').fetchall()
        if not any(json.loads(r['report']).get('ok') is True and json.loads(r['report']).get('recipe_hashes',{}).get(manifest['recipe_id'])==digest(manifest) and json.loads(r['report']).get('image')==config['renderers'][series.RENDERER]['image'] for r in rows): raise ValueError('seven_series_renderer_binding')
    from seven_series_preflight import input_check
    from storage import safe_path
    root=safe_path(config['recipe_root'],manifest['recipe_id']+'/v1')
    input_check(root,manifest,manifest['videos'][job['cursor']])
