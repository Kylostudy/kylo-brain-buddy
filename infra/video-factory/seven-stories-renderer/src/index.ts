// VPS-only fixed adapter; inert input, isolated renderer, full unchanged narration.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageVerified} from './files';
import type {MasterProps} from './theme';

async function main() {
  if (fs.lstatSync('/request.json').isSymbolicLink() || fs.statSync('/request.json').size > 256*1024) throw new Error('seven_request_too_large');
  execFileSync('python3',['-c','import json,sys;sys.path.insert(0,"/app/validation");from seven_stories import validate_request;validate_request(json.load(open("/request.json")))'],{stdio:'pipe'});
  const req = JSON.parse(fs.readFileSync('/request.json','utf8'));
  const v = req.video, t = v.timeline, stage = '/tmp/stage';
  for (const file of req.manifest.files) stageVerified(file.key,req.manifest.files);
  const originalTimeline = JSON.parse(fs.readFileSync(path.join(stage,v.audio.timeline),'utf8'));
  // Both versions are independently pinned by the Python contract and file SHA;
  // JSON member ordering differs after canonical transport and is not identity.
  if (originalTimeline.story !== v.story || originalTimeline.audio_sha256 !== t.audio_sha256) throw new Error('seven_timeline_mismatch');
  const approved = JSON.parse(fs.readFileSync('/app/validation/seven-stories-approved.json','utf8'));
  const logo = fs.readFileSync('/app/public/kylo-dog.png');
  if (createHash('sha256').update(logo).digest('hex') !== approved.dog_sha256) throw new Error('seven_logo_checksum');
  fs.mkdirSync(path.join(stage,'brand'),{recursive:true});
  fs.writeFileSync(path.join(stage,'brand/kylo-dog.png'),logo,{flag:'wx'});
  const audio = path.join(stage,v.audio.vo);
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',audio],{encoding:'utf8'}));
  const seconds = Number(probe.format.duration), frames = t.sceneFrames.reduce((a:number,b:number)=>a+b,0);
  if (Math.abs(seconds-t.audio_duration_seconds)>.002 || frames/30 < seconds+2) throw new Error('seven_full_audio_hold_required');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',audio,'-f','null','-']);
  const props: MasterProps = {story:v.story,sceneFrames:t.sceneFrames,dogAsset:'brand/kylo-dog.png',subtitles:t.subtitles};
  const serveUrl = await bundle({entryPoint:fileURLToPath(new URL('./entry.tsx',import.meta.url)),outDir:'/tmp/bundle',publicDir:stage});
  const options = {serveUrl,browserExecutable:'/usr/bin/chromium',chromeMode:'chrome-for-testing' as const,inputProps:props as unknown as Record<string,unknown>};
  const composition = await selectComposition({...options,id:'SevenStories'});
  const records = new Map<number,{frame:number;story:string;scene:number;records:unknown[]}>();
  await renderMedia({...options,composition,concurrency:1,codec:'h264',pixelFormat:'yuv420p',muted:true,crf:18,x264Preset:'medium',outputLocation:'/tmp/silent.mp4',
    onBrowserLog:log=>{const marker='SEVEN_LAYOUT ',i=log.text.indexOf(marker);if(i>=0){const r=JSON.parse(log.text.slice(i+marker.length));records.set(r.frame,r);}}});
  if (composition.durationInFrames!==frames || records.size!==frames || Array.from({length:frames},(_,i)=>i).some(i=>!records.has(i))) throw new Error('seven_layout_frames_missing');
  fs.writeFileSync('/work/layout.jsonl',[...records.values()].sort((a,b)=>a.frame-b.frame).map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
  // No -shortest, trim, time stretch, tempo or sample-rate change. Pad silence only.
  execFileSync('ffmpeg',['-nostdin','-v','error','-n','-i','/tmp/silent.mp4','-i',audio,
    '-map','0:v:0','-map','1:a:0','-c:v','copy','-af',`apad=whole_dur=${frames/30}`,
    '-c:a','aac','-b:a','256k','-movflags','+faststart','/work/output.mp4']);
  execFileSync('python3',['/app/validation/seven_media.py','/work/output.mp4',audio,'/work/layout.jsonl',v.story],{stdio:'pipe'});
}
main().catch(e=>{console.error(e instanceof Error?e.stack:String(e));process.exit(1);});