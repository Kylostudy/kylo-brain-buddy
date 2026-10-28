// Reviewed, network-free VPS entry. Recipes provide data, never executable code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {renderMedia,renderStill,selectComposition} from '@remotion/renderer';
import type {Props} from './types';

const work='/work';const stage='/tmp/stage';
function stageKey(key:string,declared:Set<string>){
  if(!declared.has(key)||! /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(key))throw new Error('unsafe_recipe_key:'+key);
  let current='/recipe';
  for(const part of key.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw new Error('symlink_recipe_key:'+key);}
  if(!fs.realpathSync(current).startsWith(fs.realpathSync('/recipe')+'/'))throw new Error('unsafe_recipe_path');
  const target=path.join(stage,key);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(current,target);return key;
}
async function main(){
  const req=JSON.parse(fs.readFileSync('/request.json','utf8'));
  if(req.manifest.schema_version!==2||!['preview','render'].includes(req.mode))throw new Error('universal_request_required');
  fs.mkdirSync(stage,{recursive:true});
  const declared=new Set<string>(req.manifest.files.map((f:{key:string})=>f.key));
  const v=req.video;
  for(const key of ['audio','font','dog','bed'])if(v[key])stageKey(v[key],declared);
  // Probe actual recipe font glyphs against all requested text, not a language label.
  const texts=[req.manifest.exam.name,req.manifest.exam.score_scale,...req.manifest.exam.vocabulary,...req.manifest.exam.sections.flatMap((s:{name:string;time:string;example:string})=>[s.name,s.time,s.example]),...v.scenes.flatMap((s:{heading:string;body:string})=>[s.heading,s.body]),v.cta,v.telegram,...req.captions.map((c:{text:string})=>c.text)];
  fs.writeFileSync('/tmp/characters.json',JSON.stringify(texts.join('')));
  execFileSync('python3',['-c',`from fontTools.ttLib import TTFont
import json,sys
font=TTFont(sys.argv[1]); chars=set(json.load(open('/tmp/characters.json')))
mapped=set().union(*(set(t.cmap) for t in font['cmap'].tables if t.isUnicode()))
missing=[hex(ord(c)) for c in chars if not c.isspace() and ord(c) not in mapped]
if missing: raise RuntimeError('font_load:missing_glyphs:'+','.join(missing[:30]))`,path.join(stage,v.font)],{stdio:'pipe'});
  const props:Props={zone:req.manifest.safe_zone,exam:req.manifest.exam,scenes:v.scenes,audio_ms:req.audio_ms,outro_ms:v.outro_ms,captions:req.captions,font:v.font,audio:v.audio,dog:v.dog,bed:v.bed,cta:v.cta,telegram:v.telegram,total_frames:Math.ceil((req.audio_ms+v.outro_ms)/1000*30)};
  const serveUrl=await bundle({entryPoint:fileURLToPath(new URL('./entry.tsx',import.meta.url)),publicDir:stage,outDir:'/tmp/bundle'});
  const options={serveUrl,browserExecutable:'/usr/bin/chromium',chromeMode:'chrome-for-testing' as const,inputProps:props as unknown as Record<string,unknown>};
  const composition=await selectComposition({...options,id:'UniversalExam'});
  const records=new Map<number,unknown>();
  const onBrowserLog=(log:{text:string})=>{const i=log.text.indexOf('KYLO_LAYOUT ');if(i>=0){const r=JSON.parse(log.text.slice(i+12));records.set(r.frame,r);}};
  let start=0;const weight=v.scenes.reduce((n:number,s:{weight:number})=>n+s.weight,0);
  const frames:number[]=v.scenes.map((s:{weight:number})=>{const duration=req.audio_ms*s.weight/weight;const frame=Math.min(props.total_frames-1,Math.floor((start+duration/2)/1000*30));start+=duration;return frame;});
  frames.push(Math.min(props.total_frames-1,Math.floor((req.audio_ms+v.outro_ms/2)/1000*30)));
  if(req.mode==='render'){
    await renderMedia({...options,composition,onBrowserLog,concurrency:1,codec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',outputLocation:work+'/output.mp4',crf:18,x264Preset:'medium'});
    if(records.size!==props.total_frames)throw new Error('qa_zone:layout_frames_missing');
  }
  for(let i=0;i<frames.length;i++) await renderStill({...options,composition,onBrowserLog,frame:frames[i],imageFormat:'jpeg',output:work+`/scene-${i}.jpg`});
  fs.writeFileSync(work+'/layout.jsonl',[...records.values()].sort((a:any,b:any)=>a.frame-b.frame).map(r=>JSON.stringify(r)).join('\n')+'\n');
  execFileSync('python3',['-c',`from PIL import Image,ImageDraw
import json,sys
root=sys.argv[1]; zone=json.loads(sys.argv[2]); sheet=Image.new('RGB',(1080,960),'black')
for i in range(8):
 im=Image.open(root+'/scene-'+str(i)+'.jpg'); d=ImageDraw.Draw(im);d.rectangle((zone['left'],zone['top'],zone['right'],zone['bottom']),outline=(0,255,100),width=5)
 im.thumbnail((270,480));sheet.paste(im,((i%4)*270,(i//4)*480))
sheet.save(root+'/contact.jpg',quality=92)`,work,JSON.stringify(props.zone)]);
  fs.writeFileSync(work+'/complete.json',JSON.stringify({preview_frames:frames,total_frames:props.total_frames}));
}
main().catch(e=>{console.error(e?.stack??String(e));process.exit(1);});