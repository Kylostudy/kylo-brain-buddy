"""Independent multilingual contract; immutable HU trial contracts are never widened."""
import json
import math
import uuid
import seven_stories as hu
from contract import keys, canonical, digest, identifier, object_key, SHA, MAX_FILE_BYTES, MAX_PACKAGE_BYTES

CONTRACT_ID = 'kylo-seven-stories-i18n-v1'
RENDERER = 'seven-stories-i18n-safe-v1'
STORIES = ('hajo','auto','repulo','ust','szamlatorony','hatizsak','malacpersely-uj')
LANGUAGES = tuple('en de nl fr ja es pt it ko pl no sv cs tr sk sl da fi ar hi sr ru ro hr el zh'.split())
SCENES = ['seven-stories-%s-i18n-v1' % s for s in hu.STORIES]
AUDIO_POLICY = {'start_ms':0,'playback_rate':1,'trim':False,'regenerate':False,'speed_filters':[],'tight_cut':False}

def recipe_id(story): return 'seven-stories-%s-series' % story

def targeted(raw):
    return isinstance(raw,dict) and (raw.get('renderer') == RENDERER or raw.get('recipe_id') in {recipe_id(s) for s in STORIES})

def text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>1200 or any(ord(c)<32 for c in value):
        raise ValueError('seven_series_text_invalid')
    return value

def timing(frames):
    if not isinstance(frames,list) or len(frames)!=7 or any(type(n) is not int or not 1<=n<=1800 for n in frames):
        raise ValueError('seven_series_frames_invalid')
    result=[]; offset=0
    for n in frames:
        result.append({'start_ms':round(offset*1000/30),'end_ms':round((offset+n)*1000/30)}); offset+=n
    return result

def validate_video(v, story, files):
    required={'video_id','language','story','scene','width','height','duration_ms','timeline','audio'}
    keys(v,required,required)
    lang=v['language']
    if lang not in LANGUAGES or v['story']!=story or v['video_id']!=story+'-'+lang or v['scene']!='seven-stories-%s-i18n-v1'%story:
        raise ValueError('seven_series_identity_invalid')
    if type(v['width']) is not int or type(v['height']) is not int or (v['width'],v['height'])!=(1080,1920):
        raise ValueError('seven_series_dimensions_invalid')
    keys(v['audio'],{'vo','alignment','timeline'},{'vo','alignment','timeline'})
    expected={'vo':lang+'/narration-mp3','alignment':lang+'/alignment-json','timeline':lang+'/timeline-json'}
    if v['audio']!=expected or any(k not in files for k in expected.values()): raise ValueError('seven_series_media_reference')
    t=v['timeline']; required={'sceneFrames','timing','duration_ms','audio_duration_us','audio_sha256','audio_policy','safe_zone','subtitles','cta','trial_days','slogan','tool_labels','direction','protected_windows_ms'}
    keys(t,required,required)
    boundaries=timing(t['sceneFrames']); duration=round(sum(t['sceneFrames'])*1000/30)
    if t['timing']!=boundaries or type(v['duration_ms']) is not int or type(t['duration_ms']) is not int or v['duration_ms']!=duration or t['duration_ms']!=duration: raise ValueError('seven_series_timing_invalid')
    if type(t['audio_duration_us']) is not int or not 1<=t['audio_duration_us']<=360000000 or duration*1000-t['audio_duration_us']<2000000: raise ValueError('seven_series_audio_hold')
    if t['audio_sha256']!=files[expected['vo']]['sha256'] or canonical(t['audio_policy'])!=canonical(AUDIO_POLICY): raise ValueError('seven_series_audio_policy')
    if canonical(t['safe_zone'])!=canonical(hu.SAFE) or t['protected_windows_ms']!=[{'start_ms':0,'end_ms':duration}]: raise ValueError('seven_series_protection')
    if type(t['trial_days']) is not int or t['trial_days']!=14: raise ValueError('seven_series_fourteen_days')
    text(t['cta']);text(t['slogan'])
    if not isinstance(t['tool_labels'],list) or len(t['tool_labels'])!=4: raise ValueError('seven_series_tools_invalid')
    for label in t['tool_labels']: text(label)
    if t['direction']!=('rtl' if lang=='ar' else 'ltr'): raise ValueError('seven_series_direction_invalid')
    subs=t['subtitles']
    if not isinstance(subs,list) or not 2<=len(subs)<=300: raise ValueError('seven_series_subtitles_invalid')
    last=0
    for sub in subs:
        keys(sub,{'start_ms','end_ms','text'},{'start_ms','end_ms','text'})
        text(sub['text'])
        if type(sub['start_ms']) is not int or type(sub['end_ms']) is not int or not last<=sub['start_ms']<sub['end_ms']<=t['audio_duration_us']/1000+2: raise ValueError('seven_series_subtitles_invalid')
        last=sub['end_ms']
    if subs[-2]['text']!='kylo.study' or subs[-1]['text']!=t['slogan'] or subs[-2]['start_ms']<boundaries[-1]['start_ms']: raise ValueError('seven_series_outro_invalid')
    return v

def validate(raw):
    required={'schema_version','recipe_id','version','renderer','series','languages','files','videos','hu_anchor'}
    keys(raw,required,required)
    stories=[s for s in STORIES if raw['recipe_id']==recipe_id(s)]
    if len(stories)!=1 or type(raw['schema_version']) is not int or raw['schema_version']!=1 or raw['version']!='v1' or raw['renderer']!=RENDERER or raw['series']!='other': raise ValueError('seven_series_recipe_invalid')
    if raw['languages']!=list(LANGUAGES): raise ValueError('seven_series_exact_26_languages')
    if len(canonical(raw))>512*1024: raise ValueError('seven_series_manifest_limit')
    if not isinstance(raw['files'],list) or len(raw['files'])!=78: raise ValueError('seven_series_exact_files')
    files={}; total=0
    for f in raw['files']:
        keys(f,{'key','bytes','sha256'},{'key','bytes','sha256'}); object_key(f['key'])
        if f['key'] in files or type(f['bytes']) is not int or not 1<=f['bytes']<=MAX_FILE_BYTES or not isinstance(f['sha256'],str) or not SHA.fullmatch(f['sha256']): raise ValueError('seven_series_file_invalid')
        files[f['key']]=f; total+=f['bytes']
    if total>MAX_PACKAGE_BYTES: raise ValueError('seven_series_package_limit')
    if not isinstance(raw['videos'],list) or len(raw['videos'])!=26 or not all(isinstance(v,dict) for v in raw['videos']) or [v.get('language') for v in raw['videos']]!=list(LANGUAGES): raise ValueError('seven_series_exact_videos')
    for v in raw['videos']: validate_video(v,stories[0],files)
    expected={key for v in raw['videos'] for key in v['audio'].values()}
    if expected!=set(files): raise ValueError('seven_series_extra_files')
    a=raw['hu_anchor']; keys(a,{'recipe_id','version','receipt_sha256'},{'recipe_id','version','receipt_sha256'})
    if a['recipe_id']!='seven-stories-%s-hu-trial'%stories[0] or a['version']!='v2' or not isinstance(a['receipt_sha256'],str) or not SHA.fullmatch(a['receipt_sha256']): raise ValueError('seven_series_hu_anchor')
    return raw

def validate_request(raw):
    keys(raw,{'manifest','video'},{'manifest','video'});validate(raw['manifest'])
    if raw['video'] not in raw['manifest']['videos']: raise ValueError('seven_series_request_video')
    return raw

def validate_command(raw):
    from contract import validate_command as legacy
    if not isinstance(raw,dict) or type(raw.get('schema_version')) is not int or raw.get('schema_version')!=1:
        raise ValueError('seven_series_command_invalid')
    op=raw.get('operation'); p=raw.get('payload')
    if op=='self_check':
        keys(raw,{'schema_version','delivery_id','operation','payload'},{'schema_version','delivery_id','operation','payload'})
        if type(raw['schema_version']) is not int or raw['schema_version']!=1 or str(uuid.UUID(raw['delivery_id']))!=raw['delivery_id']: raise ValueError('seven_series_command_invalid')
        keys(p,{'contract_id'},{'contract_id'})
        if p['contract_id']!=CONTRACT_ID: raise ValueError('seven_series_contract_invalid')
        return raw
    if op=='register_recipe':
        keys(raw,{'schema_version','delivery_id','operation','payload'},{'schema_version','delivery_id','operation','payload'})
        envelope=dict(raw,operation='status',payload={'job_id':raw['delivery_id']});legacy(envelope);validate(p);return raw
    if op=='start_series' and targeted(p):
        keys(p,{'recipe_id','version','approval','preflight_event_id'},{'recipe_id','version','approval','preflight_event_id'})
        if p['version']!='v1' or str(uuid.UUID(p['preflight_event_id']))!=p['preflight_event_id']: raise ValueError('seven_series_preflight_required')
        projected=dict(raw,payload={k:v for k,v in p.items() if k!='preflight_event_id'});legacy(projected);return raw
    if op=='trial' and targeted(p): raise ValueError('seven_series_no_hu_rerender')
    return legacy(raw)

def contract_export():
    return {'contract_id':CONTRACT_ID,'renderer':RENDERER,'version':'v1','schema_version':1,'stories':list(STORIES),'languages':list(LANGUAGES),'total_videos':182,'recipe_ids':[recipe_id(s) for s in STORIES],'scenes':SCENES,'files_per_recipe':78,'videos_per_recipe':26,'audio_policy':AUDIO_POLICY,'safe_zone':hu.SAFE,'trial_days':14,'last_but_one_caption':'kylo.study','direction':{'ar':'rtl','default':'ltr'},'archive_policy':{'path':'videos/versioned-factory/<recipe_id>/v1/<story>-<language>.mp4','overwrite':False,'publish_social':False},'concurrency':1,'batch_size':5,'required_preflight':'all seven registered recipes, 182 inputs, seven archived HU-v2 anchors, reviewed image/fonts/disk, acknowledged self_check event','video_required_fields':['video_id','language','story','scene','width','height','duration_ms','timeline','audio'],'timeline_required_fields':['sceneFrames','timing','duration_ms','audio_duration_us','audio_sha256','audio_policy','safe_zone','subtitles','cta','trial_days','slogan','tool_labels','direction','protected_windows_ms'],'alignment_fields':['characters','character_start_times_seconds','character_end_times_seconds'],'input_keys':{'vo':'<language>/narration-mp3','alignment':'<language>/alignment-json','timeline':'<language>/timeline-json'},'hu_anchor_fields':['recipe_id','version','receipt_sha256'],'operations':{'register_recipe':{'schema_version':1,'delivery_id':'UUID','operation':'register_recipe','payload':'complete recipe'},'self_check':{'schema_version':1,'delivery_id':'UUID','operation':'self_check','payload':{'contract_id':CONTRACT_ID}},'start_series':{'schema_version':1,'delivery_id':'UUID','operation':'start_series','payload':{'recipe_id':'seven-stories-<story>-series','version':'v1','preflight_event_id':'ACKed self_check UUID','approval':{'approval_id':'UUID','recipe_sha256':'canonical recipe SHA256','trial_receipt_sha256':'canonical archived HU-v2 receipt SHA256','approved_at':'UTC epoch seconds','owner_authorized':True}}}}}
