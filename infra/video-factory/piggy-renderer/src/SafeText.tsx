import React, {useLayoutEffect, useRef} from 'react';
import {delayRender, continueRender, cancelRender} from 'remotion';
import {CAPTION_SAFE_ZONE} from './captionSafeZone';
export function SafeText({id, text, top, height, size = 64}: {id: string; text: string; top: number; height: number; size?: number}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const handle = delayRender('measure:' + id);
    document.fonts.ready.then(() => {
      try {
        const el = ref.current;
        const root = el?.closest('[data-piggy-root]');
        if (!el || !root) throw new Error('piggy_missing_layout');
        let font = size;
        el.style.fontSize = font + 'px';
        while ((el.scrollHeight > height || el.scrollWidth > 845) && font > 24) el.style.fontSize = --font + 'px';
        if (el.scrollHeight > height || el.scrollWidth > 845) throw new Error('piggy_text_cannot_fit:' + id);
        const range = document.createRange(); range.selectNodeContents(el);
        const rects = [...range.getClientRects()]; const base = root.getBoundingClientRect();
        if (!rects.length || base.width <= 0) throw new Error('piggy_empty_layout:' + id);
        const bounds = {left: (Math.min(...rects.map(r => r.left)) - base.left) * 1080 / base.width,
          right: (Math.max(...rects.map(r => r.right)) - base.left) * 1080 / base.width,
          top: (Math.min(...rects.map(r => r.top)) - base.top) * 1920 / base.height,
          bottom: (Math.max(...rects.map(r => r.bottom)) - base.top) * 1920 / base.height};
        if (bounds.left < CAPTION_SAFE_ZONE.left || bounds.right > CAPTION_SAFE_ZONE.right || bounds.top < CAPTION_SAFE_ZONE.top || bounds.bottom > CAPTION_SAFE_ZONE.bottom) throw new Error('piggy_unsafe_text:' + id);
        el.dataset.bounds = JSON.stringify(bounds);
        continueRender(handle);
      } catch (error) { cancelRender(error instanceof Error ? error : new Error(String(error))); }
    }).catch(error => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [id, text, size, height]);
  return <div ref={ref} data-piggy-text={id} style={{position: 'absolute', left: 85, top, width: 845, height, fontSize: size, lineHeight: 1.16, fontWeight: 700, textAlign: 'center', color: 'var(--piggy-text)', fontFamily: 'Noto Sans, sans-serif', overflowWrap: 'anywhere', letterSpacing: 0}}>{text}</div>;
}