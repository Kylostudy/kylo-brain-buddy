import React from 'react';
import {theme as c, type Story} from './theme';

export const Tool = ({kind, x, y, size = 82}: {kind: number; x: number; y: number; size?: number}) => (
  <g transform={`translate(${x},${y}) scale(${size / 100})`}>
    <circle cx="50" cy="50" r="46" fill={c.paper}/>
    <g fill="none" stroke={c.ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
      {kind === 0 && <><rect x="25" y="20" width="50" height="60" rx="5"/><path d="M35 38h30M35 50h30M35 62h20"/></>}
      {kind === 1 && <><rect x="20" y="24" width="48" height="48" rx="5" transform="rotate(-10 44 48)"/><rect x="34" y="30" width="48" height="48" rx="5"/><path d="M47 50h22M47 62h15"/></>}
      {kind === 2 && <><path d="M20 25h60v38H52L35 78V63H20z"/><path d="M32 38h34M32 50h24"/></>}
      {kind === 3 && <><circle cx="50" cy="50" r="28"/><path d="M34 50l11 11 23-26"/></>}
    </g>
  </g>
);

const Car = ({stage}: {stage: number}) => (
  <g>
    {[165, 535].map(x => <g key={x}><circle cx={x} cy="340" r={stage === 0 ? 60 : 49} fill={c.ink}/><circle cx={x} cy="340" r="32" fill={c.gold}/>{stage === 0 && [0,45,90,135].map(a => <path key={a} d={`M${x-42} 340h84`} transform={`rotate(${a} ${x} 340)`} stroke={c.paper} strokeWidth="3"/>)}</g>)}
    {stage === 0 ? <>
      <path d="M85 265h215v-98h170v96h125v56H85z" fill={c.background} stroke={c.gold} strokeWidth="9"/>
      <path d="M274 157h220v20H274zM330 178v87M467 178v87" fill={c.ink} stroke={c.gold} strokeWidth="7"/>
      <rect x="88" y="231" width="150" height="65" rx="8" fill={c.panel}/><circle cx="86" cy="247" r="16" fill={c.goldLight}/>
    </> : <>
      <path d={stage === 1 ? 'M65 295l56-64h122l60-100h143l98 100h75v80H65z' : stage === 2 ? 'M55 285l110-72 132-77h141l117 81 91 72v36H55z' : 'M50 290l142-78 109-62h117l150 84 87 57v32H50z'} fill={stage === 1 ? c.blue : stage === 2 ? c.green : c.gold}/>
      <path d="M270 220l57-68h91l73 68z" fill={c.panel}/><path d="M368 153v65" stroke={c.paper} strokeWidth="5"/>
      <path d="M99 285h82M545 279h61" stroke={c.goldLight} strokeWidth="14" strokeLinecap="round"/>
    </>}
  </g>
);

const Boat = ({stage}: {stage: number}) => (
  <g>
    <path d={stage === 0 ? 'M120 285h460l-78 86H225z' : stage === 1 ? 'M90 268h535l-110 107H175z' : 'M50 285h605l-120 112H150z'} fill={stage === 3 ? c.gold : c.blue}/>
    {stage === 0 ? <><path d="M224 215l190 134M425 215L244 349" stroke={c.paper} strokeWidth="17" strokeLinecap="round"/><path d="M230 280h250" stroke={c.ink} strokeWidth="10"/></> : <>
      <path d={stage === 1 ? 'M210 266v-79h240v79z' : stage === 2 ? 'M152 283V172h370l63 111z' : 'M150 283l65-62h50v-60h237l93 122z'} fill={c.paper}/>
      {stage < 3 && <><rect x="285" y="112" width="54" height="75" fill={c.gold}/><rect x="276" y="105" width="72" height="17" fill={c.ink}/></>}
      {Array.from({length: stage + 3}, (_, i) => <circle key={i} cx={212+i*62} cy="238" r="14" fill={c.panel}/>)}
      {stage > 1 && <path d="M218 193h240M200 211h300" stroke={c.blue} strokeWidth="6"/>}
    </>}
    <path d="M80 418q65-22 130 0t130 0t130 0t130 0" stroke={c.blue} strokeWidth="7" fill="none"/>
  </g>
);

const Plane = ({stage}: {stage: number}) => (
  <g>
    {stage === 0 ? <>
      <path d="M70 185h560v34H70zM70 290h560v34H70z" fill={c.paper}/>
      {[115,240,465,580].map(x => <path key={x} d={`M${x} 216v77M${x} 216l70 77`} stroke={c.gold} strokeWidth="5"/>)}
      <path d="M240 260h175l95 56H310z" fill={c.gold}/><path d="M400 226v105M525 205v86" stroke={c.ink} strokeWidth="7"/>
      <path d="M520 222v93" stroke={c.blue} strokeWidth="8"/>
    </> : <>
      <path d="M55 265q15-30 120-37h315l85-90h46l-35 93 72 36-20 31H163q-95-3-108-33z" fill={stage === 3 ? c.paper : c.blue}/>
      <path d={stage === 3 ? 'M265 256l105-133h73l-56 133 84 113h-83z' : 'M295 258l74-97h47l-48 97 64 83h-67z'} fill={c.gold}/>
      {Array.from({length: 10}, (_, i) => <circle key={i} cx={172+i*30} cy="249" r="6" fill={c.ink}/>)}
      {stage === 3 && Array.from({length: 9}, (_, i) => <circle key={i} cx={191+i*31} cy="268" r="5" fill={c.ink}/>)}
      {(stage === 3 ? [235,290,395,450] : [280,430]).map(x => <rect key={x} x={x} y="289" width="36" height="38" rx="12" fill={c.panel}/>)}
      {stage === 1 && [180,515].map(x => <path key={x} d={`M${x} 245v90`} stroke={c.paper} strokeWidth="7"/>)}
    </>}
  </g>
);

const Pig = ({stage}: {stage: number}) => (
  <g transform={`translate(${35-stage*8},${40-stage*8}) scale(${0.9+stage*0.07})`}>
    <path d="M185 318v63h48v-50M420 321v60h47v-55" fill={c.pinkDark}/>
    <ellipse cx="330" cy="245" rx="190" ry="125" fill={c.pink}/>
    <path d="M375 139l42-62 36 84" fill={c.pinkDark}/>
    <ellipse cx="509" cy="252" rx="41" ry="32" fill={c.pinkDark}/>
    <circle cx="492" cy="250" r="6" fill={c.ink}/><circle cx="516" cy="250" r="6" fill={c.ink}/>
    <circle cx="438" cy="214" r="10" fill={c.ink}/>
    <path d="M420 278q25 20 44 0M152 239q-50-10-42-35q18-18 28 4" fill="none" stroke={c.ink} strokeWidth="7"/>
    <path d="M270 135h96" stroke={c.ink} strokeWidth="10" strokeLinecap="round"/>
  </g>
);

const Pot = ({stage}: {stage: number}) => (
  <g>
    <path d="M160 225q-82-55-75 40q0 60 70 44M545 225q82-55 75 40q0 60-70 44" fill="none" stroke={c.gold} strokeWidth="20"/>
    <path d="M155 211h390l-33 171q-160 62-322 0z" fill={c.blue}/>
    <ellipse cx="350" cy="211" rx="195" ry="35" fill={c.panel} stroke={c.gold} strokeWidth="13"/>
    {stage === 4 && <path d="M190 175h320" stroke={c.gold} strokeWidth="6"/>}
    {Array.from({length: Math.min(4,stage + 1)}, (_, i) => <Tool key={i} kind={i%4} x={stage === 4 ? 165+i*100 : 210+i*69} y={stage === 4 ? 140 : 135-(i%2)*65} size={72}/>)}
  </g>
);

const Invoices = ({stage}: {stage: number}) => (
  <g>
    {stage === 4 ? <>
      <rect x="155" y="155" width="390" height="255" rx="18" fill={c.blue} stroke={c.gold} strokeWidth="6"/>
      <path d="M180 255h340M350 175v205" stroke={c.goldLight} strokeWidth="4"/>
      {Array.from({length:4},(_,i)=><Tool key={i} kind={i} x={220+(i%2)*180} y={170+Math.floor(i/2)*120} size={88}/>)}
    </> : Array.from({length: stage + 1}, (_, i) => <g key={i} transform={`translate(${250+(i%2)*25},${310-i*68}) rotate(${i%2 ? 5 : -3})`}>
      <path d="M0 0h205v104l-14-8-14 8-14-8-14 8-14-8-14 8-14-8-14 8-14-8-14 8-14-8-14 8-14-8L0 104z" fill={c.paper}/>
      <Tool kind={i%4} x={8} y={8} size={65}/><path d="M94 29h80M94 47h62M94 65h71" stroke={c.ink} strokeWidth="6"/>
    </g>)}
  </g>
);

const Backpack = ({stage}: {stage: number}) => (
  <g>
    <path d="M285 150v-35q65-55 130 0v35M210 190q-70 20-70 180M490 190q70 20 70 180" stroke={c.gold} strokeWidth="24" fill="none"/>
    <rect x="205" y="140" width="290" height="280" rx="58" fill={c.green}/>
    <rect x="240" y="295" width="220" height="102" rx="25" fill={c.panel}/>
    <path d="M235 212h230M259 329h182" stroke={c.goldLight} strokeWidth="9"/>
    {Array.from({length: 4}, (_, i) => <Tool key={i} kind={i} x={stage >= 3 ? 260+(i%2)*95 : 145+i*108} y={stage >= 3 ? 180+Math.floor(i/2)*95 : 100-(i%2)*65} size={75}/>)}
  </g>
);

export function StoryObject({story, stage}: {story: Story; stage: number}) {
  switch (story) {
    case 'auto': return <Car stage={stage}/>;
    case 'hajo': return <Boat stage={stage}/>;
    case 'repulo': return <Plane stage={stage}/>;
    case 'ust': return <Pot stage={stage}/>;
    case 'szamlatorony': return <Invoices stage={stage}/>;
    case 'hatizsak': return <Backpack stage={stage}/>;
    case 'malacpersely-uj': return <Pig stage={stage}/>;
  }
}