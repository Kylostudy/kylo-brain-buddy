// VPS-only entrypoint for exam-simulator-v1. Input is inert data, never remote code; no network.
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
  const request = '/request.json', stage = '/tmp/stage';
  if (fs.statSync(request).size > 256 * 1024) throw new Error('sim_request_too_large');
  // The pinned Python contract decides acceptance before Chromium starts.
  execFileSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"/app/validation");from exam_simulator import validate_request;validate_request(json.load(open("/request.json")))'], {stdio: 'pipe'});
  const req = JSON.parse(fs.readFileSync(request, 'utf8'));
  const v = req.video, files = req.manifest.files;
  for (const file of files) stageVerified(file.key, files);
  const lens = validateSceneFrames(v.timing.sceneFrames);
  // Local immutable brand asset; no recipe may replace it.
  fs.mkdirSync(path.join(stage, 'brand'), {recursive: true});
  fs.copyFileSync('/app/public/kylo-dog.png', path.join(stage, 'brand/kylo-dog.png'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(stage, v.audio.vo)], {encoding: 'utf8'}));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!probe.streams.some((s: {codec_type: string}) => s.codec_type === 'audio') || Math.abs(Number(probe.format.duration) * 30 - total) > 2) throw new Error('sim_vo_length_mismatch');
  const props: Props = {sceneFrames: lens, screens: v.screens, subs: v.subtitle, logo: 'brand/kylo-dog.png'};
  const serveUrl = await bundle({entryPoint: fileURLToPath(new URL('./entry.tsx', import.meta.url)), outDir: '/tmp/bundle', publicDir: stage});
  const options = {serveUrl, browserExecutable: '/usr/bin/chromium', chromeMode: 'chrome-for-testing' as const, inputProps: props as unknown as Record<string, unknown>};
  const composition = await selectComposition({...options, id: 'ExamSimulator'});
  const records = new Map<number, unknown>();
  await renderMedia({...options, composition, concurrency: 1, codec: 'h264', pixelFormat: 'yuv420p', muted: true, crf: 18, x264Preset: 'medium', outputLocation: '/tmp/silent.mp4',
    onBrowserLog: (log) => { const m = 'SIM_LAYOUT '; const i = log.text.indexOf(m); if (i >= 0) { const r = JSON.parse(log.text.slice(i + m.length)); records.set(r.frame, r); } }});
  if (records.size !== composition.durationInFrames) throw new Error('sim_layout_frames_missing');
  execFileSync('python3', ['/app/validation/exam_audio.py', request, stage, '/tmp/mix.wav'], {stdio: 'pipe'});
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-n', '-i', '/tmp/silent.mp4', '-i', '/tmp/mix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', '/work/output.mp4']);
  fs.writeFileSync('/work/layout.jsonl', [...records.values()].sort((a: any, b: any) => a.frame - b.frame).map(r => JSON.stringify(r)).join('\n') + '\n', {flag: 'wx'});
}
main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
