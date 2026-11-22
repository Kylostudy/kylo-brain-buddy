import React, {useLayoutEffect, useRef} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';
import {theme} from './theme';

// Measure inline glyph ranges, NEVER the fixed-height flex container's scrollHeight.
export function Caption({text, top = 270, maxHeight = 225, size = 60}: {text: string; top?: number; maxHeight?: number; size?: number}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const handle = delayRender('seven_caption_fit');
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      try {
        const el = ref.current;
        if (!el) throw new Error('seven_caption_missing');
        const range = document.createRange(); range.selectNodeContents(el);
        let font = size;
        const measure = () => range.getBoundingClientRect();
        el.style.fontSize = `${font}px`;
        const root = el.closest('[data-seven-root]');
        if (!root) throw new Error('seven_root_missing');
        const scale = root.getBoundingClientRect().width / 1080;
        if (scale <= 0) throw new Error('seven_empty_layout');
        while ((measure().height > maxHeight * scale || measure().width > 805 * scale) && font > 32) el.style.fontSize = `${--font}px`;
        if (measure().height > maxHeight * scale || measure().width > 805 * scale) throw new Error('seven_caption_cannot_fit');
        el.dataset.fitted = text; continueRender(handle);
      } catch (e) {cancelRender(e instanceof Error ? e : new Error(String(e)));}
    }).catch(e => cancelRender(e instanceof Error ? e : new Error(String(e))));
    return () => {cancelled = true; continueRender(handle);};
  }, [text, size, maxHeight]);
  return <div style={{position:'absolute',left:105,top,width:805,maxHeight,fontFamily:"'Noto Sans','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans CJK SC','Noto Sans CJK JP','Noto Sans CJK KR',sans-serif",fontWeight:800,lineHeight:1.22,textAlign:'center',color:theme.white,letterSpacing:0,overflowWrap:'anywhere'}}>
    <span ref={ref} data-seven-text style={{fontSize:size}}>{text}</span>
  </div>;
}