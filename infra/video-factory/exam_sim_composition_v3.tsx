import React, {useLayoutEffect} from 'react';
import {AbsoluteFill, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {KyloExamSimulatorMaster} from './KyloExamSimulatorMaster';
import {Caption} from './Caption';
import {validateSceneFrames} from './timing';
import type {Props} from './types';
import {CAPTION_SAFE_ZONE as Z} from './captionSafeZone';
// Layout v3 (overlay): every text-bearing element (full visible box incl. shadow) ([data-sim-text]: phone screenshots, cards) is
// measured each frame against the shared safe zone, including transforms; any overflow fails closed.
function elementBounds() {
  const root = document.querySelector<HTMLElement>('[data-sim-root]');
  if (!root) throw new Error('sim_missing_layout');
  const base = root.getBoundingClientRect();
  if (base.width <= 0 || base.height <= 0) throw new Error('sim_empty_layout');
  return [...document.querySelectorAll<HTMLElement>('[data-sim-text]')].map(el => {
    const r = el.getBoundingClientRect();
    // v3: the visible frame includes border (in the rect) and every box-shadow, scaled with the element.
    const scale = r.width / Math.max(1, el.offsetWidth);
    let [sl, sr, st, sb] = [0, 0, 0, 0];
    for (const part of getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/)) {
      if (part.trim() === 'none' || part.includes('inset')) continue;
      const n = (part.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat);
      const [x = 0, y = 0, blur = 0, spread = 0] = n; const e = blur + spread;
      sl = Math.max(sl, e - x); sr = Math.max(sr, e + x); st = Math.max(st, e - y); sb = Math.max(sb, e + y);
    }
    const b = {name: el.dataset.simText, left: (r.left - sl * scale - base.left) * 1080 / base.width, right: (r.right + sr * scale - base.left) * 1080 / base.width,
      top: (r.top - st * scale - base.top) * 1920 / base.height, bottom: (r.bottom + sb * scale - base.top) * 1920 / base.height};
    if (b.left < Z.left - 0.5 || b.right > Z.right + 0.5 || b.top < Z.top - 0.5 || b.bottom > Z.bottom + 0.5) throw new Error('sim_unsafe_element ' + JSON.stringify(b));
    return b;
  });
}
// Silent video: audio is mixed afterwards by validation/exam_audio.py (ffmpeg, -14 LUFS).
export function ExamSimulator(p: Props) {
  const frame = useCurrentFrame(); const lens = validateSceneFrames(p.sceneFrames);
  const ms = frame * 1000 / 30;
  const sub = p.subs.find(s => ms >= s.start_ms && ms < s.end_ms);
  useLayoutEffect(() => {
    const handle = delayRender('sim_layout_frame');
    const timer = setInterval(() => {
      try {
        const el = document.querySelector<HTMLElement>('[data-sim-caption]');
        if (el && !el.dataset.bounds) return;
        clearInterval(timer);
        const elements = elementBounds();
        console.log('SIM_LAYOUT ' + JSON.stringify({frame, caption: el ? JSON.parse(el.dataset.bounds ?? '{}') : null, elements}));
        continueRender(handle);
      } catch (error) { clearInterval(timer); cancelRender(error instanceof Error ? error : new Error(String(error))); }
    }, 20);
    return () => clearInterval(timer);
  }, [frame]);
  // Declare the real coordinate space before measurement (metadata mounts in a zero-sized portal).
  return <AbsoluteFill data-sim-root style={{width: 1080, height: 1920}}>
    <KyloExamSimulatorMaster sceneFrames={lens} screens={p.screens} logo={p.logo}/>
    {sub && <Caption key={sub.start_ms} text={sub.text}/>}
  </AbsoluteFill>;
}
