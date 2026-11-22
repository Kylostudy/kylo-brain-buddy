"""Shared series media QA: unchanged waveform algorithm, localized full-frame checks."""
import json
import hashlib
import math
from pathlib import Path
from seven_media import pcm, waveform_metrics
from seven_series import validate_request


def verify_layout(path,video):
    if Path(path).is_symlink(): raise ValueError('seven_unsafe_layout')
    t=video['timeline']; lens=t['sceneFrames']; rows=[json.loads(s) for s in Path(path).read_text().splitlines()]
    if len(rows)!=sum(lens): raise ValueError('seven_layout_frames_missing')
    offset=0; scene=0
    for frame,row in enumerate(rows):
        while frame>=offset+lens[scene]: offset+=lens[scene];scene+=1
        if row.get('frame')!=frame or row.get('story')!=video['story'] or row.get('scene')!=scene: raise ValueError('seven_layout_frame_mismatch')
        records=row.get('records')
        if not isinstance(records,list) or not records or not any(r.get('kind')=='object' for r in records): raise ValueError('seven_layout_empty')
        for r in records:
            vals=[r.get(k) for k in ('left','right','top','bottom')]
            if any(type(n) not in (int,float) or not math.isfinite(n) for n in vals): raise ValueError('seven_layout_bounds_missing')
            a,b,c,d=vals
            if not 65<=a<b<=950 or not 231<=c<d<=1459: raise ValueError('seven_unsafe_bounds')
        for i,a in enumerate(records):
            for b in records[i+1:]:
                if 'text' in (a.get('kind'),b.get('kind')) and a['left']<b['right'] and a['right']>b['left'] and a['top']<b['bottom'] and a['bottom']>b['top']: raise ValueError('seven_layout_overlap')
        ms=frame*1000/30; sub=next((s for s in t['subtitles'] if s['start_ms']<=ms<s['end_ms']),None)
        texts=[r.get('text') for r in records if r.get('kind')=='text']
        if sub and sub['text'] not in texts: raise ValueError('seven_caption_missing')
        if scene==5 and t['cta'] not in texts: raise ValueError('seven_cta_missing')
        if scene==6 and not {'kylo.study',t['slogan']}<=set(texts): raise ValueError('seven_outro_missing')
    return {'frames':len(rows),'all_frames_checked':True,'safe_zone':t['safe_zone'],'layout_sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest()}


def verify(output,audio,layout,video):
    reference=pcm(audio);actual=pcm(output);t=video['timeline']
    if abs(len(actual)/48-t['duration_ms'])>100 or len(actual)-len(reference)<48000*2: raise ValueError('seven_full_audio_hold_required')
    return {'waveform':waveform_metrics(reference,actual),'layout':verify_layout(layout,video),'tight_cut':False,'original_audio_sha256':hashlib.sha256(Path(audio).read_bytes()).hexdigest()}

if __name__=='__main__':
    import sys
    request=validate_request(json.loads(Path('/request.json').read_text()))
    print(json.dumps(verify(*sys.argv[1:4],request['video'])))
