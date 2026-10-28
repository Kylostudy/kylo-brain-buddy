import React, {useLayoutEffect,useRef,useState} from 'react';
import {AbsoluteFill,Audio,Img,staticFile,useCurrentFrame,delayRender,continueRender,cancelRender} from 'remotion';
import {Props,Rect,sceneAt} from './types';
import {fitElement,textBounds} from './layout';

function intersects(a:Rect,b:Rect) {return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
function Fitted({id,text,rect,color,fontSize=56,font}:{id:string;text:string;rect:Rect;color:string;fontSize?:number;font:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const frame=useCurrentFrame();
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    try{fitElement(el,rect,fontSize);}catch(e){cancelRender(e);}
  },[text,rect.top,rect.bottom,rect.left,rect.right,fontSize,frame]);
  return <div ref={ref} data-box={id} dir="auto" style={{position:'absolute',left:rect.left,top:rect.top,width:rect.right-rect.left,maxHeight:rect.bottom-rect.top,fontFamily:font,fontSize,lineHeight:1.2,fontWeight:800,textAlign:'center',color,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{text}</div>;
}

export const Universal:React.FC<Props>=(p)=>{
  const frame=useCurrentFrame();const ms=frame/30*1000;const current=sceneAt(p,ms);
  const root=useRef<HTMLDivElement>(null);
  const [fontGate]=useState(()=>delayRender('recipe-font'));
  const [fontReady,setFontReady]=useState(false);
  const layoutGate=React.useMemo(()=>delayRender('frame-layout'),[frame]);
  const font='KyloRecipe';const zone=p.zone;const height=zone.bottom-zone.top;const width=zone.right-zone.left;
  const skin=p.exam.skin;
  const isOutro=current.scene.kind==='outro';
  const progress=Math.max(0,Math.min(1,(ms-current.start)/(current.end-current.start)));
  const caption=p.captions.find(c=>ms>=c.start_ms&&ms<c.end_ms);
  // The protected central illustration and textual bands never compete.
  const visual:Rect={left:zone.left+width*.24,right:zone.right-width*.24,top:zone.top+height*.35,bottom:zone.top+height*.65};
  const forbidden=[...current.scene.forbidden,visual];
  const band=(a:number,b:number):Rect=>({left:zone.left+12,right:zone.right-12,top:zone.top+height*a,bottom:zone.top+height*b});
  useLayoutEffect(()=>{
    const face=new FontFace(font,`url(${staticFile(p.font)})`);
    face.load().then(()=>{document.fonts.add(face);setFontReady(true);continueRender(fontGate);}).catch(e=>cancelRender(e));
  },[p.font,fontGate]);
  useLayoutEffect(()=>{
    if(!fontReady)return;
    let cancelled=false;
    document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(cancelled)return;
      const base=root.current?.getBoundingClientRect();if(!base)return;
      const scaleX=1080/base.width;const scaleY=1920/base.height;
      const boxes:({id:string}&Rect)[]=[];
      let invalid=false;
      root.current?.querySelectorAll<HTMLElement>('[data-box]').forEach(el=>{
        // Refit after the requested font is loaded, before measuring any text.
        try{fitElement(el,{left:0,right:parseFloat(el.style.width),top:0,bottom:parseFloat(el.style.maxHeight)},parseFloat(el.style.fontSize));}catch(e){invalid=true;cancelRender(e);return;}
        const r={id:el.dataset.box??'',...textBounds(el,base)};
        if(r.left<zone.left-.01||r.right>zone.right+.01||r.top<zone.top-.01||r.bottom>zone.bottom+.01||forbidden.some(f=>intersects(r,f))) {invalid=true;cancelRender(new Error(`qa_zone:${current.scene.kind}:${r.id}:${JSON.stringify(r)}`));return;}
        boxes.push(r);
      });
      console.log('KYLO_LAYOUT '+JSON.stringify({frame,scene:current.scene.kind,boxes,forbidden:isOutro?[]:forbidden}));
      if(!invalid)continueRender(layoutGate);
    })));
    return ()=>{cancelled=true;};
  },[frame,fontReady,layoutGate]);
  const heading=current.scene.kind==='cta'?p.cta:current.scene.heading;
  let body=current.scene.body;
  if(current.scene.kind==='questions')body+='\n'+p.exam.sections.map(s=>s.name+' · '+s.time+'\n'+s.example).join('\n');
  if(current.scene.kind==='simulation')body+='\n'+p.exam.score_scale;
  if(current.scene.kind==='feedback')body+='\n'+p.exam.sample_percent+'% · '+p.exam.vocabulary.join(' · ');
  if(current.scene.kind==='cta')body+='\n'+p.telegram;
  return <AbsoluteFill ref={root} style={{background:isOutro?'#000000':skin.background}}>
    <Audio src={staticFile(p.audio)}/>
    {p.bed&&<Audio src={staticFile(p.bed)} volume={.08}/>}
    {!isOutro&&<>
      <Fitted id="exam-name" text={p.exam.name} rect={band(.01,.09)} color={skin.accent} font={font} fontSize={38}/>
      <Fitted id="heading" text={heading} rect={band(.11,.31)} color={skin.foreground} font={font} fontSize={72}/>
      <div style={{position:'absolute',left:visual.left,top:visual.top,width:visual.right-visual.left,height:visual.bottom-visual.top,display:'flex',alignItems:'center',justifyContent:'center',transform:`scale(${.92+.08*Math.sin(progress*Math.PI)})`}}>
        {current.scene.kind==='cta'||current.scene.kind==='understanding'?<Img src={staticFile(p.dog)} style={{width:'90%',height:'90%',objectFit:'contain'}}/>
          :<div style={{width:240,height:240,borderRadius:'50%',border:`14px solid ${skin.accent}`,transform:`rotate(${progress*45}deg)`,opacity:.6+progress*.4}}/>}
      </div>
      <Fitted id="body" text={body} rect={band(.67,.82)} color={skin.muted} font={font} fontSize={40}/>
      {caption&&<Fitted id="caption" text={caption.text} rect={band(.85,.99)} color={skin.foreground} font={font} fontSize={44}/>}
    </>}
  </AbsoluteFill>;
};