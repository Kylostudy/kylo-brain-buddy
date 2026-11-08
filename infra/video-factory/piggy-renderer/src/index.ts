// VPS-only entrypoint. Input is inert data, never remote code.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageVerified} from './files';
import {validateSceneFrames} from './timing';
import type {Props} from './types';
async function main() {
  const request='/request.json', stage='/tmp/stage';
  if(fs.statSync(request).size > 512*1024) throw new Error('piggy_request_too_large');
  const req=JSON.parse(fs.readFileSync(request,'utf8'));
  // Independently validate the complete factory contract before starting Chromium.
  execFileSync('python3',['-c', 'import json,sys;sys.path.insert(0,"/app/validation");from contract import validate_recipe;r=json.load(open("/request.json"));validate_recipe(r["manifest"]);assert r["video"]==r["manifest"]["videos"][0]'],{stdio:'pipe'});
  const v=req.video, files=req.manifest.files;
  for(const file of files) stageVerified(file.key,files);
  const lens=validateSceneFrames(JSON.parse(fs.readFileSync(path.join(stage,v.master),'utf8')).sceneFrames);
  const expected=v.timing.map((t:{start_ms:number;end_ms:number})=>Math.round(t.end_ms*30/1000)-Math.round(t.start_ms*30/1000));
  if(JSON.stringify(lens)!==JSON.stringify(expected)) throw new Error('piggy_scene_frames_mismatch');
  // Local immutable brand asset; no recipe may replace it.
  fs.mkdirSync(path.join(stage,'assets'),{recursive:true}); fs.copyFileSync('/app/public/kylo-dog.png',path.join(stage,'assets/kylo-dog.png'));
  const audio=path.join(stage,v.audio);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',audio],{encoding:'utf8'}));
  const narrationFrames=Math.ceil(Number(probe.format.duration)*30);
  if(!Number.isFinite(narrationFrames)|| narrationFrames<1 || !probe.streams.some((s:{codec_type:string})=>s.codec_type==='audio') || narrationFrames>lens.slice(0,6).reduce((a,b)=>a+b,0)) throw new Error('piggy_audio_timing_mismatch');
  const props:Props={sceneFrames:lens,text:JSON.parse(v.text),subs:JSON.parse(v.subtitle).subs,cta:JSON.parse(v.cta),audio:v.audio,bed:files.some((f:{key:string})=>f.key==='audio/bed-mp3')?'audio/bed-mp3':undefined};
  const serveUrl=await bundle({entryPoint:fileURLToPath(new URL('./entry.tsx',import.meta.url)),outDir:'/tmp/bundle',publicDir:stage});
  const options={serveUrl,browserExecutable:'/usr/bin/chromium',chromeMode:'chrome-for-testing' as const,inputProps:props as unknown as Record<string,unknown>};
  const composition=await selectComposition({...options,id:'PiggyBank'});
  const records=new Map<number,unknown>();
  await renderMedia({...options,composition,concurrency:1,codec:'h264',pixelFormat:'yuv420p',audioCodec:'aac',crf:18,x264Preset:'medium',outputLocation:'/work/output.mp4',onBrowserLog:(log)=>{const marker='PIGGY_LAYOUT ';const i=log.text.indexOf(marker);if(i>=0){const r=JSON.parse(log.text.slice(i+marker.length));records.set(r.frame,r);}}});
  if(records.size!==composition.durationInFrames) throw new Error('piggy_layout_frames_missing');
  fs.writeFileSync('/work/layout.jsonl',[...records.values()].sort((a:any,b:any)=>a.frame-b.frame).map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
}
main().catch(error=>{console.error(error instanceof Error ? error.stack : String(error));process.exit(1);});