import React, {useLayoutEffect} from 'react';
import {AbsoluteFill, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {KyloExamSimulatorMaster} from './KyloExamSimulatorMaster';
import {Caption} from './Caption';
import {validateSceneFrames} from './timing';
import type {Props} from './types';
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
        console.log('SIM_LAYOUT ' + JSON.stringify({frame, caption: el ? JSON.parse(el.dataset.bounds ?? '{}') : null}));
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
