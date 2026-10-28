import type {Rect} from './types';
export function fitElement(el:HTMLElement,rect:Rect,maxSize:number) {
  let size=maxSize;el.style.fontSize=size+'px';
  while((el.scrollHeight>rect.bottom-rect.top || el.scrollWidth>rect.right-rect.left)&&size>16){size--;el.style.fontSize=size+'px';}
  if(el.scrollHeight>rect.bottom-rect.top||el.scrollWidth>rect.right-rect.left)throw new Error('qa_zone:text_cannot_fit:'+el.dataset.box);
  return size;
}
export function textBounds(el:HTMLElement,base:DOMRect) {
  const range=document.createRange();range.selectNodeContents(el);const lines=[...range.getClientRects()];
  if(!lines.length)throw new Error('qa_zone:empty_text:'+el.dataset.box);
  return {left:(Math.min(...lines.map(r=>r.left))-base.left)*1080/base.width,right:(Math.max(...lines.map(r=>r.right))-base.left)*1080/base.width,top:(Math.min(...lines.map(r=>r.top))-base.top)*1920/base.height,bottom:(Math.max(...lines.map(r=>r.bottom))-base.top)*1920/base.height};
}