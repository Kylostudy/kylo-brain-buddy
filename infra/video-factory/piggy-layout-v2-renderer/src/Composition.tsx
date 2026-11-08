import React, {useLayoutEffect} from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import type {Props} from './types';
import {KyloPiggyBankMaster} from './KyloPiggyBankMaster';
import {sceneAt, validateSceneFrames} from './timing';
import {SafeText} from './SafeText';

export function PiggyBank(p: Props) {
  const frame = useCurrentFrame(); const lens = validateSceneFrames(p.sceneFrames);
  const {index, local} = sceneAt(frame, lens);
  const design = [120,300,120,300,150,90,90];
  const f = local * design[index] / lens[index];
  const counter = index === 0 ? (f >= 70 ? 0 : -1) : 1 + [30,90,150,210].filter(hit => f >= hit).length - 1;
  const step = f < 80 ? 0 : f < 150 ? 1 : f < 215 ? 2 : 3;
  const ms = frame * 1000 / 30;
  const sub = p.subs.find(s => ms >= s.start_ms && ms < s.end_ms);
  useLayoutEffect(() => {
    const handle = delayRender('piggy_layout_frame');
    const timer = setInterval(() => {
      try {
        const els = [...document.querySelectorAll<HTMLElement>('[data-piggy-text]')];
        if (els.some(el => !el.dataset.bounds)) return;
        const records = els.map(el => ({id: el.dataset.piggyText, ...JSON.parse(el.dataset.bounds ?? '{}')}));
        for (let i = 0; i < records.length; i++) for (let j = i+1; j < records.length; j++) {
          const a=records[i], b=records[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) throw new Error('piggy_text_overlap');
        }
        clearInterval(timer);console.log('PIGGY_LAYOUT ' + JSON.stringify({frame, boxes: records})); continueRender(handle);
      } catch(error) {clearInterval(timer);cancelRender(error instanceof Error ? error : new Error(String(error)));}
    }, 20);
    return () => clearInterval(timer);
  }, [frame]);
  // Metadata evaluation mounts inside a zero-sized offscreen Remotion portal.
  // Declare the actual coordinate space before any text measurement occurs.
  return <AbsoluteFill data-piggy-root style={{width: 1080, height: 1920, '--piggy-text': '#E8EEF7'} as React.CSSProperties}>
    <KyloPiggyBankMaster sceneFrames={lens}/>
    {index === 0 && <SafeText id="heading" text={p.text.heading} top={240} height={170} size={58}/>}
    {index <= 1 && counter >= 0 && <>
      <SafeText id="counter" text={p.text.counter_values[counter] + ' USD/hó'} top={430} height={125} size={96}/>
      <SafeText id="label" text={p.text.labels[counter]} top={565} height={110} size={38}/>
    </>}
    {(index === 1 || index === 2) && <SafeText id="disclaimer" text={p.text.disclaimer} top={680} height={100} size={30}/>}
    {index === 2 && <SafeText id="truth" text={p.text.truth} top={370} height={220} size={76}/>}
    {index === 3 && <SafeText id="flow" text={p.text.steps[step]} top={245} height={150} size={54}/>}
    {index === 4 && <SafeText id="price" text={p.text.price} top={930} height={180} size={100}/>}
    {index === 5 && <>
      <SafeText id="cta" text={p.cta.text} top={1040} height={120} size={76}/>
      <SafeText id="trial" text={p.cta.supporting_text} top={1170} height={100} size={44}/>
    </>}
    {index === 6 && <>
      <SafeText id="url" text={p.text.outro_url} top={1060} height={90}/>
      <SafeText id="tagline" text={p.text.outro_tagline} top={1165} height={70} size={44}/>
    </>}
    {sub && index < 6 && <SafeText id="subtitle" text={sub.text} top={1290} height={150} size={44}/>}
    <Audio src={staticFile(p.audio)}/>
    {p.bed && <Audio src={staticFile(p.bed)} volume={0.2}/>}
  </AbsoluteFill>;
}