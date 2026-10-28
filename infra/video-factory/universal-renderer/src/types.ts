export type Rect = {left:number;right:number;top:number;bottom:number};
export type Scene = {kind:string;heading:string;body:string;weight:number;forbidden:Rect[]};
export type Props = {
  zone:Rect; exam:{name:string;sections:{name:string;time:string;example:string}[];score_scale:string;sample_percent:number;vocabulary:string[];skin:Record<string,string>};
  scenes:Scene[]; audio_ms:number; outro_ms:number; captions:{start_ms:number;end_ms:number;text:string}[];
  font:string; audio:string; dog:string; bed?:string; cta:string; telegram:string; total_frames:number;
};
export function sceneAt(p:Props, ms:number) {
  let start=0;
  const total=p.scenes.reduce((n,s)=>n+s.weight,0);
  for(let i=0;i<p.scenes.length;i++) {
    const end=start+p.audio_ms*p.scenes[i].weight/total;
    if(ms<end) return {scene:p.scenes[i],index:i,start,end};
    start=end;
  }
  return {scene:{kind:'outro',heading:'',body:'',weight:1,forbidden:[]},index:7,start:p.audio_ms,end:p.audio_ms+p.outro_ms};
}