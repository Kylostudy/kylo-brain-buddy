import React, {useLayoutEffect, useRef} from 'react';
import {delayRender, continueRender, cancelRender} from 'remotion';
import {CAPTION_SAFE_ZONE, captionBounds} from './captionSafeZone';
// Fonts come from the reviewed base image (fonts-noto-core); Hungarian accents are in Noto Sans.
const FONT_FAMILY = "'Noto Sans',sans-serif";
export function Caption({text}: {text: string}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = captionBounds(); const width = box.right - box.left; const height = box.bottom - box.top - 14;
  useLayoutEffect(() => {
    const handle = delayRender('sim_caption_measure');
    document.fonts.ready.then(() => {
      try {
        const el = ref.current; const root = el?.closest('[data-sim-root]');
        if (!el || !root) throw new Error('sim_missing_layout');
        let font = 60; el.style.fontSize = font + 'px';
        while ((el.scrollHeight > height || el.scrollWidth > width) && font > 30) el.style.fontSize = --font + 'px';
        if (el.scrollHeight > height || el.scrollWidth > width) throw new Error('sim_caption_cannot_fit');
        const range = document.createRange(); range.selectNodeContents(el);
        const rects = [...range.getClientRects()]; const base = root.getBoundingClientRect();
        if (!rects.length || base.width <= 0) throw new Error('sim_empty_layout');
        const b = {left: (Math.min(...rects.map(r => r.left)) - base.left) * 1080 / base.width,
          right: (Math.max(...rects.map(r => r.right)) - base.left) * 1080 / base.width,
          top: (Math.min(...rects.map(r => r.top)) - base.top) * 1920 / base.height,
          bottom: (Math.max(...rects.map(r => r.bottom)) - base.top) * 1920 / base.height};
        if (b.left < CAPTION_SAFE_ZONE.left || b.right > CAPTION_SAFE_ZONE.right || b.top < box.top || b.bottom > box.bottom) throw new Error('sim_unsafe_caption');
        el.dataset.bounds = JSON.stringify(b); continueRender(handle);
      } catch (error) { cancelRender(error instanceof Error ? error : new Error(String(error))); }
    }).catch(error => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [text]);
  return <div ref={ref} data-sim-caption style={{position: 'absolute', left: box.left, top: box.top, width, height, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontSize: 60, lineHeight: 1.18, fontWeight: 800, textAlign: 'center', color: '#FFFFFF', textShadow: '0 3px 10px rgba(0,0,0,0.85), 0 0 2px #000', fontFamily: FONT_FAMILY, overflowWrap: 'anywhere'}}>{text}</div>;
}
