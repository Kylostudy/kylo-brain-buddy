import React, {useLayoutEffect} from 'react';
import {AbsoluteFill, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {KyloExamSimulatorMaster} from './KyloExamSimulatorMaster';
import {Caption} from './Caption';
import {validateSceneFrames} from './timing';
import type {Props} from './types';
import {CAPTION_SAFE_ZONE as Z} from './captionSafeZone';
// Layout v2 (overlay): every text-bearing element ([data-sim-text]: phone screenshots, cards) is
// measured each frame against the shared safe zone, including transforms; any overflow fails closed.
function elementBounds() {
  const root = document.querySelector<HTMLElement>('[data-sim-root]');
  if (!root) throw new Error('sim_missing_layout');
  const base = root.getBoundingClientRect();
  if (base.width <= 0 || base.height <= 0) throw new Error('sim_empty_layout');
  return [...document.querySelectorAll<HTMLElement>('[data-sim-text]')].map(el => {
    const r = el.getBoundingClientRect();
    const b = {name: el.dataset.simText, left: (r.left - base.left) * 1080 / base.width, right: (r.right - base.left) * 1080 / base.width,
      top: (r.top - base.top) * 1920 / base.height, bottom: (r.bottom - base.top) * 1920 / base.height};
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
