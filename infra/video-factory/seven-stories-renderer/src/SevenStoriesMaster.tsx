import React, {useLayoutEffect, useRef} from 'react';
import {Img, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {theme as c, type MasterProps} from './theme';
import {StoryObject, Tool} from './StoryObjects';
import {Caption} from './Caption';
import {sceneAt, displayText} from './timing';

const safe = {left:65,right:950,top:231,bottom:1459};
const toolLabels = ['Jegyzet','Tanulókártyák','Magyarázat','Gyakorlás'];

export function SevenStoriesMaster(p: MasterProps) {
  const frame = useCurrentFrame();
  const {index,local} = sceneAt(frame,p.sceneFrames);
  const stage = index===4 && ['ust','szamlatorony','hatizsak'].includes(p.story) ? 4 : Math.min(index,3);
  const blend = index > 0 && (index < 4 || stage===4) ? Math.min(1,local/18) : 1;
  const vehicle = ['hajo','auto','repulo'].includes(p.story);
  const connected = index >= 4;
  const count = vehicle ? Math.min(4,index+1) : 4;
  const sub = p.subtitles.find(s => frame*1000/30 >= s.start_ms && frame*1000/30 < s.end_ms);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const handle = delayRender('seven_frame_bounds');
    let cancelled = false;
    Promise.all([document.fonts.ready, ...Array.from(rootRef.current?.querySelectorAll('img') ?? []).map(img => img.decode())]).then(() => {
      if (cancelled) return;
      const poll = () => {
        if (cancelled) return;
        try {
          const root = rootRef.current;
          if (!root) throw new Error('seven_root_missing');
          const texts = Array.from(root.querySelectorAll<HTMLElement>('[data-seven-text]'));
          if (texts.some(el => el.dataset.fitted !== el.textContent)) {requestAnimationFrame(poll);return;}
          const base = root.getBoundingClientRect();
          if (base.width <= 0 || base.height <= 0) throw new Error('seven_empty_layout');
          const sx = 1080/base.width, sy = 1920/base.height;
          const bounds = (r: DOMRect) => ({left:(r.left-base.left)*sx,right:(r.right-base.left)*sx,top:(r.top-base.top)*sy,bottom:(r.bottom-base.top)*sy});
          const records = texts.map(el => {
            const range = document.createRange();range.selectNodeContents(el);
            return {kind:'text',text:el.textContent,...bounds(range.getBoundingClientRect())};
          });
          const objects = Array.from(root.querySelectorAll<HTMLElement>('[data-seven-object]')).map(el => ({kind:'object',text:'',...bounds(el.getBoundingClientRect())}));
          for (const b of [...records,...objects]) {
            if (b.left < safe.left || b.right > safe.right || b.top < safe.top || b.bottom > safe.bottom || b.right <= b.left || b.bottom <= b.top) throw new Error('seven_unsafe_bounds');
          }
          for (const a of records) for (const b of objects) {
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) throw new Error('seven_text_object_overlap');
          }
          for (let i=0;i<records.length;i++) for (const b of records.slice(i+1)) {
            const a=records[i];
            if (a && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) throw new Error('seven_text_overlap');
          }
          console.log('SEVEN_LAYOUT '+JSON.stringify({frame,story:p.story,scene:index,records:[...records,...objects]}));
          continueRender(handle);
        } catch (e) {cancelRender(e instanceof Error ? e : new Error(String(e)));}
      };
      poll();
    }).catch(e => cancelRender(e instanceof Error ? e : new Error(String(e))));
    return () => {cancelled=true;continueRender(handle);};
  },[frame,p.story]);
  return <div ref={rootRef} data-seven-root style={{position:'absolute',inset:0,width:1080,height:1920,backgroundColor:index===6?c.black:c.background}}>
    {sub && <Caption key={sub.start_ms} text={displayText(sub.text)}/>}
    {index < 5 && <>
      <svg data-seven-object width="810" height="575" viewBox="0 0 700 500" style={{position:'absolute',left:100,top:525,overflow:'hidden'}}>
        <ellipse cx="350" cy="447" rx="280" ry="12" fill={c.panel}/>
        <g transform={`translate(0,${Math.sin(frame/38)*4})`}>
          {blend < 1 && <g opacity={1-blend}><StoryObject story={p.story} stage={stage-1}/></g>}
          <g opacity={blend}><StoryObject story={p.story} stage={stage}/></g>
          {vehicle && stage===3 && <image href={staticFile(p.dogAsset)} x="310" y={p.story==='auto'?245:p.story==='hajo'?295:236} width="55" height="55"/>}
          {!vehicle && !connected && p.story!=='hatizsak' && Array.from({length:Math.min(4,index+1)},(_,i)=><g key={i} transform={`translate(${115+i*135},${45+Math.sin((frame+i*7)/20)*8})`}>
            <circle cx="0" cy="0" r="19" fill={c.gold}/><circle cx="0" cy="0" r="13" fill="none" stroke={c.goldLight} strokeWidth="2"/>
          </g>)}
          {connected && !vehicle && <path d="M90 470h520" stroke={c.gold} strokeWidth="5"/>}
        </g>
      </svg>
      <svg data-seven-object width="780" height="110" viewBox="0 0 780 110" style={{position:'absolute',left:115,top:1135}}>
        {Array.from({length:count},(_,i)=><g key={i}>
          {connected && i>0 && <path d={`M${i*195-70} 50h75`} stroke={c.gold} strokeWidth="5"/>}
          <Tool kind={i} x={i*195+50} y={5} size={90}/>
        </g>)}
      </svg>
      <div style={{position:'absolute',left:115,top:1280,width:780,display:'flex',justifyContent:'flex-start'}}>
        {Array.from({length:count},(_,i)=><span key={i} data-seven-text data-fitted={toolLabels[i]??''} style={{width:195,flexShrink:0,textAlign:'center',fontFamily:"'Noto Sans',sans-serif",fontSize:26,fontWeight:700,color:c.white,lineHeight:1.3}}>{toolLabels[i]??''}</span>)}
      </div>
    </>}
    {index===5 && <>
      <Img data-seven-object src={staticFile(p.dogAsset)} style={{position:'absolute',left:340,top:600,width:340,height:340,objectFit:'contain',filter:'sepia(1) saturate(2.4) brightness(1.15)',transform:`translateY(${-Math.min(local,60)/6}px)`}}/>
      <Caption text="Próbáld ki ingyen 14 napig!" top={1150} maxHeight={220} size={64}/>
    </>}
    {index===6 && <>
      <Img data-seven-object src={staticFile(p.dogAsset)} style={{position:'absolute',left:365,top:680,width:280,height:280,objectFit:'contain'}}/>
      <Caption text="kylo.study" top={1100} maxHeight={100} size={66}/>
      <Caption text="A te AI magántanárod" top={1260} maxHeight={150} size={44}/>
    </>}
  </div>;
}