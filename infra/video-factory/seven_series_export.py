#!/usr/bin/env python3
"""KyLogic data assembler. No network, audio generation, registration or production."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import seven_series as s
from contract import canonical,digest
from seven_series_preflight import input_check


def assemble(root,story,anchor_sha256):
    files=[];videos=[];contents={}
    for lang in s.LANGUAGES:
        base=Path(root)/story/lang
        source=json.loads((base/'timeline.json').read_text())
        required={'sceneFrames','audio_duration_us','subtitles','cta','slogan','tool_labels'}
        if set(source)!=required: raise ValueError('seven_series_source_fields')
        audio=(base/'narration.mp3').read_bytes(); alignment=(base/'alignment.json').read_bytes()
        t=copy.deepcopy(source);bounds=s.timing(t['sceneFrames']);duration=bounds[-1]['end_ms']
        t.update(timing=bounds,duration_ms=duration,audio_sha256=hashlib.sha256(audio).hexdigest(),
            audio_policy=copy.deepcopy(s.AUDIO_POLICY),safe_zone=copy.deepcopy(s.hu.SAFE),trial_days=14,
            direction='rtl' if lang=='ar' else 'ltr',protected_windows_ms=[{'start_ms':0,'end_ms':duration}])
        refs={'vo':lang+'/narration-mp3','alignment':lang+'/alignment-json','timeline':lang+'/timeline-json'}
        data=(audio,alignment,canonical(t))
        for key,body in zip(refs.values(),data):
            files.append({'key':key,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()});contents[key]=body
        videos.append({'video_id':story+'-'+lang,'language':lang,'story':story,'scene':'seven-stories-%s-i18n-v1'%story,
            'width':1080,'height':1920,'duration_ms':duration,'timeline':t,'audio':refs})
    manifest={'schema_version':1,'recipe_id':s.recipe_id(story),'version':'v1','renderer':s.RENDERER,'series':'other',
        'languages':list(s.LANGUAGES),'files':files,'videos':videos,'hu_anchor':{'recipe_id':'seven-stories-%s-hu-trial'%story,'version':'v2','receipt_sha256':anchor_sha256}}
    s.validate(manifest)
    return manifest,contents


def write_exclusive(path,body):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes()!=body: raise ValueError('immutable_export_conflict')
    else:
        with path.open('xb') as f:f.write(body)


def export(root,anchors,output):
    if not isinstance(anchors,dict) or set(anchors)!=set(s.STORIES): raise ValueError('seven_series_seven_anchors_required')
    prepared=[];errors=[]
    for story in s.STORIES:
        try:prepared.append(assemble(root,story,anchors[story]))
        except (ValueError,KeyError,OSError) as e: errors.append({'story':story,'stage':'assemble','code':type(e).__name__})
    if errors:return {'ok':False,'errors':errors,'recipes_exported':False}
    recipes=[]
    for m,contents in prepared:
        target=Path(output)/m['recipe_id']/m['version']
        for key,body in contents.items():write_exclusive(target/key,body)
        for v in m['videos']:
            try:input_check(target,m,v)
            except (ValueError,KeyError,OSError) as e:errors.append({'story':v['story'],'language':v['language'],'stage':'audio_alignment','code':type(e).__name__})
        recipes.append({'recipe_id':m['recipe_id'],'version':m['version'],'recipe_sha256':digest(m)})
    if errors:return {'ok':False,'errors':errors,'recipes_exported':False}
    for m,_ in prepared:write_exclusive(Path(output)/(m['recipe_id']+'.json'),canonical(m))
    return {'ok':True,'recipes':recipes,'total_videos':182,'recipes_exported':True,'render_started':False,'registered':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--inputs',required=True);parser.add_argument('--anchors',required=True);parser.add_argument('--output',required=True)
    a=parser.parse_args();report=export(a.inputs,json.loads(Path(a.anchors).read_text()),a.output)
    print(json.dumps(report,ensure_ascii=False,indent=2));raise SystemExit(0 if report['ok'] else 1)
