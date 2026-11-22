import copy,json,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import seven_series as s
from contract import digest,canonical
from recipe_runtime import validate_recipe,validate_command
from state import State
from storage import LocalArchive
from seven_series_state import record
from seven_series_media import verify_layout


def cmd(op,p): return {'schema_version':1,'delivery_id':str(uuid.uuid4()),'operation':op,'payload':p}

def manifest(story='hajo',anchor='a'*64):
    files=[];videos=[]
    for lang in s.LANGUAGES:
        refs={'vo':lang+'/narration-mp3','alignment':lang+'/alignment-json','timeline':lang+'/timeline-json'}
        for key in refs.values(): files.append({'key':key,'bytes':1,'sha256':'b'*64})
        frames=[30]*6+[120];timing=s.timing(frames);duration=10000
        t={'sceneFrames':frames,'timing':timing,'duration_ms':duration,'audio_duration_us':8000000,'audio_sha256':'b'*64,'audio_policy':copy.deepcopy(s.AUDIO_POLICY),'safe_zone':copy.deepcopy(s.hu.SAFE),'subtitles':[{'start_ms':6000,'end_ms':7000,'text':'kylo.study'},{'start_ms':7000,'end_ms':8000,'text':'Your AI tutor'}],'cta':'Try free for 14 days!','trial_days':14,'slogan':'Your AI tutor','tool_labels':['Notes','Cards','Explain','Practice'],'direction':'rtl' if lang=='ar' else 'ltr','protected_windows_ms':[{'start_ms':0,'end_ms':duration}]}
        videos.append({'video_id':story+'-'+lang,'language':lang,'story':story,'scene':'seven-stories-%s-i18n-v1'%story,'width':1080,'height':1920,'duration_ms':duration,'timeline':t,'audio':refs})
    return {'schema_version':1,'recipe_id':s.recipe_id(story),'version':'v1','renderer':s.RENDERER,'series':'other','languages':list(s.LANGUAGES),'files':files,'videos':videos,'hu_anchor':{'recipe_id':'seven-stories-%s-hu-trial'%story,'version':'v2','receipt_sha256':anchor}}


class SeriesTests(unittest.TestCase):
    def test_exact_182_and_26_including_ru_zh(self):
        self.assertEqual(s.contract_export()['total_videos'],182)
        self.assertEqual(len(s.LANGUAGES),26);self.assertIn('ru',s.LANGUAGES);self.assertIn('zh',s.LANGUAGES)
        for story in s.STORIES: self.assertEqual(validate_recipe(manifest(story))['recipe_id'],s.recipe_id(story))
    def test_hungarian_is_not_rerendered(self):
        p=manifest();p['languages'][0]='hu'
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_no_speedup(self):
        p=manifest();p['videos'][0]['timeline']['audio_policy']['playback_rate']=1.01
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_no_tight_cut(self):
        p=manifest();p['videos'][0]['timeline']['audio_policy']['tight_cut']=True
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_audio_zero_start(self):
        p=manifest();p['videos'][0]['timeline']['audio_policy']['start_ms']=1
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_no_trim(self):
        p=manifest();p['videos'][0]['timeline']['audio_policy']['trim']=True
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_two_second_hold(self):
        p=manifest();p['videos'][0]['timeline']['audio_duration_us']=8000001
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_trial_is_exactly_14_days(self):
        p=manifest();p['videos'][0]['timeline']['trial_days']=7
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_domain_exact_latin(self):
        p=manifest();p['videos'][0]['timeline']['subtitles'][-2]['text']='Kylo pont study.'
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_arabic_rtl(self):
        p=manifest();v=next(v for v in p['videos'] if v['language']=='ar');v['timeline']['direction']='ltr'
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_bounds_fixed(self):
        p=manifest();p['videos'][0]['timeline']['safe_zone']['right']=951
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_missing_language_rejected(self):
        p=manifest();p['videos'].pop()
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_source_code_and_urls_rejected(self):
        p=manifest();p['files'][0]['url']='https://evil.invalid/run'
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_audio_hash_binding(self):
        p=manifest();p['files'][0]['sha256']='c'*64
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_scene_frames_single_source(self):
        p=manifest();p['videos'][0]['timeline']['sceneFrames'][0]+=1
        with self.assertRaises(ValueError):validate_recipe(p)
    def test_series_cannot_use_trial_operation(self):
        with self.assertRaises(ValueError):validate_command(cmd('trial',{'recipe_id':s.recipe_id('hajo'),'version':'v1'}))
    def test_self_check_format(self):
        c=cmd('self_check',{'contract_id':s.CONTRACT_ID});self.assertEqual(validate_command(c),c)
        c['payload']['contract_id']='old'
        with self.assertRaises(ValueError):validate_command(c)
    def test_missing_frames_block_archive(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'layout';path.write_text('{}\n')
            with self.assertRaises(ValueError):verify_layout(path,manifest()['videos'][0])
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name)
        self.state=State(root/'state.db',LocalArchive(root/'archive'))
    def tearDown(self):self.temp.cleanup()
    def setup_series(self):
        hashes={};self.recipes={}
        for story in s.STORIES:
            key='seven-stories-%s-hu-trial/v2/%s-hu'%(story,story)
            receipt={'schema_version':1,'storage_type':'local','object_key':key,'bytes':1,'sha256':'a'*64,'media':{}}
            with self.state.transaction() as db:
                db.execute("INSERT INTO jobs(id,recipe,version,mode,status,trial_receipt) VALUES(?,?,?,'trial','completed',?)",(str(uuid.uuid4()),'seven-stories-%s-hu-trial'%story,'v2',canonical(receipt).decode()))
            p=manifest(story,digest(receipt));self.recipes[story]=p;hashes[p['recipe_id']]=digest(p)
            self.state.apply(cmd('register_recipe',p))
        report={'ok':True,'contract_sha256':digest(s.contract_export()),'recipe_hashes':hashes,'image':'sha256:'+'d'*64}
        self.event=record(self.state,report)
    def start(self,story='hajo'):
        p=self.recipes[story]
        return self.state.apply(cmd('start_series',{'recipe_id':p['recipe_id'],'version':'v1','preflight_event_id':self.event,'approval':{'approval_id':str(uuid.uuid4()),'recipe_sha256':digest(p),'trial_receipt_sha256':p['hu_anchor']['receipt_sha256'],'approved_at':int(time.time()),'owner_authorized':True}}))
    def test_ack_required_before_start(self):
        self.setup_series()
        with self.assertRaisesRegex(ValueError,'ack_required'):self.start()
    def test_actual_archive_required(self):
        self.setup_series();self.state.acknowledge(self.event)
        with self.assertRaises(ValueError):self.start()
    def test_one_job_per_story_idempotent_and_restart_safe(self):
        self.setup_series();self.state.acknowledge(self.event)
        with patch.object(self.state.archive,'verify',return_value=True):
            a=self.start();b=self.start();self.assertEqual(a['id'],b['id'])
            self.state=State(self.state.path,self.state.archive);c=self.start();self.assertEqual(c['id'],a['id'])
    def test_serial_and_fail_stops_sibling_story(self):
        self.setup_series();self.state.acknowledge(self.event)
        with patch.object(self.state.archive,'verify',return_value=True):self.start();self.start('auto')
        job=self.state.claim();self.assertIsNotNone(job);self.assertEqual(job['manifest']['videos'][0]['story'],'hajo')
        self.assertIsNone(self.state.claim());self.state.fail(job,'test_failure');self.assertIsNone(self.state.claim())
    def test_contracts_stay_immutable(self):
        import seven_caption_v2,seven_stories
        for story in s.STORIES:
            self.assertEqual(validate_recipe(seven_caption_v2.template(story))['languages'],['hu'])
            self.assertEqual(validate_recipe(seven_stories.template(story))['languages'],['hu'])
    def test_preflight_checks_every_one_of_182_inputs(self):
        self.setup_series()
        from seven_series_preflight import run
        with patch('seven_series_preflight.input_check',side_effect=ValueError('bad')),patch('seven_series_preflight.anchors',return_value={}):
            r=run({'recipe_root':self.temp.name,'renderers':{}},self.state)
        self.assertEqual(len(r['videos']),182);self.assertFalse(r['ok']);self.assertFalse(r['input_ok'])
    def test_preflight_stale_recipe_rejected(self):
        self.setup_series();self.state.acknowledge(self.event)
        with self.state.transaction() as db:db.execute("UPDATE recipes SET hash=? WHERE id=?",('x'*64,s.recipe_id('auto')))
        with self.assertRaisesRegex(ValueError,'stale'):self.start()
    def test_unapproved_start_rejected(self):
        self.setup_series();p=self.recipes['hajo']
        c=cmd('start_series',{'recipe_id':p['recipe_id'],'version':'v1','preflight_event_id':self.event,'approval':{'approval_id':str(uuid.uuid4()),'recipe_sha256':digest(p),'trial_receipt_sha256':p['hu_anchor']['receipt_sha256'],'approved_at':int(time.time()),'owner_authorized':False}})
        with self.assertRaises(ValueError):validate_command(c)
    def test_activation_accepts_only_series_scene_grants(self):
        from test_reviewed_renderers import run,IMG
        code,cfg,_=run({s.RENDERER:{'image':IMG,'reviewed':True,'scenes':s.SCENES}})
        self.assertEqual(code,0);self.assertEqual(cfg['renderers'][s.RENDERER]['scenes'],s.SCENES)
        code,_,_=run({s.RENDERER:{'image':IMG,'reviewed':True,'scenes':['seven-stories-hajo-hu-v1']}})
        self.assertNotEqual(code,0)
    def test_all_runtime_dependencies_are_staged(self):
        root=Path(__file__).parent
        for script in ('install.sh','activate-manager.sh'):
            content=(root/script).read_text()
            for name in ('seven_series.py','seven_series_media.py','seven_series_preflight.py','seven_series_state.py'):
                self.assertIn(name,content)
    def test_host_and_container_validators_identical(self):
        root=Path(__file__).parent
        for name in ('seven_series.py','seven_series_media.py','seven_series_preflight.py','seven_audio.py'):
            self.assertEqual((root/name).read_bytes(),(root/'seven-series-renderer'/'validation'/name).read_bytes())
    def test_export_has_only_one_timing_source(self):
        from seven_series_export import assemble
        root=Path(self.temp.name)/'inputs'
        for lang in s.LANGUAGES:
            base=root/'hajo'/lang;base.mkdir(parents=True)
            source={'sceneFrames':[30]*6+[120],'audio_duration_us':8000000,'subtitles':[{'start_ms':6000,'end_ms':7000,'text':'kylo.study'},{'start_ms':7000,'end_ms':8000,'text':'Your AI tutor'}],'cta':'Try free for 14 days!','slogan':'Your AI tutor','tool_labels':['Notes','Cards','Explain','Practice']}
            (base/'timeline.json').write_text(json.dumps(source));(base/'alignment.json').write_text('{}');(base/'narration.mp3').write_bytes(b'audio')
        p,files=assemble(root,'hajo','a'*64)
        self.assertEqual(p['videos'][0]['duration_ms'],10000)
        self.assertEqual(len(files),78)
        self.assertEqual(validate_recipe(p),p)
    def test_export_never_overwrites_data(self):
        from seven_series_export import write_exclusive
        path=Path(self.temp.name)/'asset';write_exclusive(path,b'first');write_exclusive(path,b'first')
        with self.assertRaises(ValueError):write_exclusive(path,b'second')
        self.assertEqual(path.read_bytes(),b'first')

if __name__=='__main__':unittest.main()
