"""Aggregate all seven immutable recipes; no render, queue claim or archive mutation."""
import datetime
import json
import math
import shutil
import subprocess
from pathlib import Path
import seven_series as series
import seven_audio
from contract import digest
from storage import safe_path, checksum

ERROR_CODES = {'seven_series_hu_receipt_missing','seven_series_hu_archive_unverified',
    'seven_series_recipe_hash','seven_series_input_checksum','seven_series_timeline_mismatch',
    'seven_series_alignment_invalid','seven_audio_duration','seven_series_renderer_binding',
    'seven_series_renderer_digest','low_disk','seven_series_legacy_check','seven_series_font_glyphs'}

def error_code(error):
    return str(error) if isinstance(error,ValueError) and str(error) in ERROR_CODES else type(error).__name__


def anchors(state, db, manifest):
    a=manifest['hu_anchor']
    row=db.execute("SELECT trial_receipt FROM jobs WHERE recipe=? AND version=? AND mode='trial' AND status='completed'",(a['recipe_id'],a['version'])).fetchone()
    if not row or not row['trial_receipt']: raise ValueError('seven_series_hu_receipt_missing')
    receipt=json.loads(row['trial_receipt'])
    expected=a['recipe_id']+'/v2/'+manifest['videos'][0]['story']+'-hu'
    if receipt.get('object_key')!=expected or digest(receipt)!=a['receipt_sha256'] or state.archive is None or not state.archive.verify(receipt): raise ValueError('seven_series_hu_archive_unverified')
    return receipt


def input_check(root, manifest, video):
    for key in video['audio'].values():
        descriptor=next(f for f in manifest['files'] if f['key']==key)
        path=safe_path(root,key)
        if not path.is_file() or path.stat().st_size!=descriptor['bytes'] or checksum(path)!=descriptor['sha256']: raise ValueError('seven_series_input_checksum')
    t=video['timeline']; stored=json.loads(safe_path(root,video['audio']['timeline']).read_text())
    if stored!=t: raise ValueError('seven_series_timeline_mismatch')
    measure=seven_audio.verify(safe_path(root,video['audio']['vo']),t['audio_duration_us']/1000000,t['duration_ms'])
    a=json.loads(safe_path(root,video['audio']['alignment']).read_text())
    if set(a)!={'characters','character_start_times_seconds','character_end_times_seconds'}: raise ValueError('seven_series_alignment_invalid')
    chars,starts,ends=[a[k] for k in ('characters','character_start_times_seconds','character_end_times_seconds')]
    if not all(isinstance(x,list) for x in (chars,starts,ends)) or not 0<len(chars)==len(starts)==len(ends)<=50000: raise ValueError('seven_series_alignment_invalid')
    for ch,x,y in zip(chars,starts,ends):
        if not isinstance(ch,str) or not ch or any(type(n) not in (int,float) or not math.isfinite(n) for n in (x,y)) or not 0<=x<=y<=t['audio_duration_us']/1000000+.002: raise ValueError('seven_series_alignment_invalid')
    if any(x>y for x,y in zip(starts,starts[1:])): raise ValueError('seven_series_alignment_invalid')
    return measure


def run(config,state):
    report={'contract_id':series.CONTRACT_ID,'contract_sha256':digest(series.contract_export()),'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'recipe_hashes':{},'videos':[],'errors':[],'image':None,'render_started':False,'production_QA_pending':True}
    manifests=[]
    with state.transaction() as db:
        for story in series.STORIES:
            row=db.execute('SELECT * FROM recipes WHERE id=? AND version=?',(series.recipe_id(story),'v1')).fetchone()
            if not row:
                report['errors'].append({'story':story,'stage':'registration','code':'seven_series_recipe_missing'});continue
            try:
                manifest=series.validate(json.loads(row['manifest']))
                if digest(manifest)!=row['hash']: raise ValueError('seven_series_recipe_hash')
                report['recipe_hashes'][manifest['recipe_id']]=row['hash'];manifests.append(manifest)
                anchors(state,db,manifest)
            except (ValueError,KeyError,OSError) as e:
                report['errors'].append({'story':story,'stage':'hu_anchor','code':error_code(e)})
    for manifest in manifests:
        root=safe_path(config['recipe_root'],manifest['recipe_id']+'/v1')
        for video in manifest['videos']:
            row={'story':video['story'],'language':video['language'],'ok':False}
            try:
                row['audio_measurement']=input_check(root,manifest,video);row['ok']=True
            except (ValueError,KeyError,OSError,subprocess.SubprocessError) as e:
                row['error']={'stage':'input_audio_alignment','code':error_code(e)}
            report['videos'].append(row)
    stage='renderer_binding'
    try:
        renderer=config['renderers'][series.RENDERER]
        reviewed=json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
        if renderer!=reviewed.get(series.RENDERER) or renderer.get('reviewed') is not True or renderer.get('scenes')!=series.SCENES: raise ValueError('seven_series_renderer_binding')
        stage='renderer_digest';image=renderer['image']
        if not image.startswith('sha256:') or len(image)!=71: raise ValueError('seven_series_renderer_digest')
        actual=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',image],text=True,timeout=30).strip()
        if actual!=image: raise ValueError('seven_series_renderer_digest')
        report['image']=image;stage='shared_fonts'
        subprocess.run(['docker','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65532:65532','--entrypoint','python3',image,'-c','import subprocess; p=subprocess.run(["dpkg-query","-W","-f=${Status}\\n","fonts-noto-core","fonts-noto-cjk"],capture_output=True,text=True); assert p.returncode==0 and p.stdout.splitlines()==["install ok installed"]*2'],check=True,capture_output=True,timeout=60)
        stage='input_glyph_coverage'
        texts=[text for m in manifests for v in m['videos'] for text in
               [v['timeline']['cta'],v['timeline']['slogan'],*v['timeline']['tool_labels'],
                *[s['text'] for s in v['timeline']['subtitles']]]]
        code='''import json,sys,subprocess
texts=json.load(sys.stdin)
ranges=subprocess.check_output(["fc-list","--format","%{charset}\\n"],text=True)
covered=set()
for token in ranges.split():
    pair=token.split("-"); first=int(pair[0],16);last=int(pair[-1],16)
    covered.update(range(first,last+1))
assert all(ord(c) in covered for t in texts for c in t if not c.isspace()), "seven_series_font_glyphs"
'''
        subprocess.run(['docker','run','--rm','-i','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65532:65532','--entrypoint','python3',image,'-c',code],input=json.dumps(texts).encode(),capture_output=True,check=True,timeout=90)
        stage='disk_space'
        for key in ('work_root','archive_root'):
            usage=shutil.disk_usage(config[key])
            if usage.free<config['min_free_bytes'] or usage.used/usage.total>config['max_disk_fraction']: raise ValueError('low_disk')
        stage='legacy_self_check'
        from universal_runtime import self_check
        report['legacy_self_check']=self_check(config)
        if not report['legacy_self_check'].get('ok'): raise ValueError('seven_series_legacy_check')
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as e:
        report['errors'].append({'stage':stage,'code':error_code(e)})
    report['input_ok']=len(report['videos'])==182 and all(v['ok'] for v in report['videos'])
    report['ok']=report['input_ok'] and len(report['recipe_hashes'])==7 and not report['errors'] and report['image'] is not None
    return report
