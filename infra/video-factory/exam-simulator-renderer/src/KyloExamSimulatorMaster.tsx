import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";

/**
 * Kylo – Vizsgaszimulátor posztervideó (9:16) — NÉMA, feliratmentes master.
 * NEM RENDERELT. Csak felülvizsgált helyi VPS-kiadásként telepíthető; sandboxban render TILOS.
 * A képernyőképek nyelvenkénti bemenetek (`screens`), így a master maga nyelvsemleges:
 * minden olvasható felirat, narráció és CTA a nyelvi overlay-rétegben kerül rá.
 * 7 jelenet: horog → izgalom → feltöltés/beállítás → szigorú professzor → futó dolgozat →
 * eredmény → márkazárás (megemelt arany kutya, majd fekete zárókép normál logóval).
 */
export const SIM_FPS = 30;
export const SIM_WIDTH = 1080;
export const SIM_HEIGHT = 1920;
/** Logó: a képbe épített, változtathatatlan márkafájl (prop: logo). Képek: checksumolt receptkulcsok. */
// Safe-zone: telefon alja ≤ 160+80+900+20 = 1160 < 1190; professzor-kivágás x 65–950.
export const SIM_DESIGN_FRAMES = [105, 120, 135, 105, 105, 120, 210];
export type SimProps = {
  sceneFrames?: number[];
  /** 4 kép: [beállítás, professzor-gombok (kivágás), futó dolgozat, eredmény] */
  screens: [string, string, string, string];
  /** skin-azonosító csak naplózáshoz */
  skin?: string;
  logo: string;
};
export const simTotalFrames = (p: Pick<SimProps, "sceneFrames">) =>
  (p.sceneFrames ?? SIM_DESIGN_FRAMES).reduce((a, b) => a + b, 0);

const C = { navy: "#0A1628", deep: "#050C18", mid: "#12264A", gold: "#E9B44C", goldLite: "#FFE3A3",
  goldDeep: "#A8791C", red: "#E0524F", green: "#3FBF7F", line: "rgba(200,212,230,0.16)" };
const EO = Easing.out(Easing.cubic);
const ci = (f: number, i: number[], o: number[], e?: (t: number) => number) =>
  interpolate(f, i, o, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
const sp = (f: number) => spring({ frame: f, fps: SIM_FPS, config: { damping: 13, stiffness: 120 } });

export function sceneRanges(frames: number[]) {
  if (frames.length !== 7 || frames.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error("sceneFrames_invalid");
  let s = 0; return frames.map((n) => { const r = [s, s + n]; s += n; return r; });
}

const Scene: React.FC<{ range: number[]; design: number; children: (f: number) => React.ReactNode }> = ({ range, design, children }) => {
  const frame = useCurrentFrame(); const [a, b] = range;
  if (frame < a || frame >= b) return null;
  const op = ci(frame, [a, a + 8, b - 8, b], [0, 1, 1, 0]);
  return <AbsoluteFill style={{ opacity: op }}>{children((frame - a) * (design / (b - a)))}</AbsoluteFill>;
};

const Bg: React.FC = () => { const f = useCurrentFrame(); return (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 1400px at 50% ${40 + Math.sin(f / 90) * 3}%, ${C.mid}, ${C.deep} 70%)` }}>
    <AbsoluteFill style={{ backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`, backgroundSize: "90px 90px", opacity: 0.3 }} />
  </AbsoluteFill>); };

// Képernyőkép telefonkeretben, a felirat-zóna (alsó harmad) fölött.
const Phone: React.FC<{ src: string; f: number; scroll?: number; top?: number }> = ({ src, f, scroll = 0, top = 160 }) => {
  const s = sp(f); const y = ci(f, [0, 20], [80, 0], EO);
  return (
    <div style={{ position: "absolute", left: 210, top: top + y, width: 660, height: 900, borderRadius: 56, overflow: "hidden",
      border: `10px solid #1B2A44`, boxShadow: "0 30px 80px rgba(0,0,0,0.55)", transform: `scale(${0.92 + 0.08 * s})`, background: "#0b1220" }}>
      <Img src={staticFile(src)} style={{ width: "100%", transform: `translateY(${-scroll}px)` }} />
    </div>);
};

const Clock: React.FC<{ f: number }> = ({ f }) => (
  <svg width={360} height={360} viewBox="0 0 100 100" style={{ position: "absolute", left: 360, top: 420 }}>
    <circle cx="50" cy="50" r="44" fill="none" stroke={C.gold} strokeWidth="5" />
    <line x1="50" y1="50" x2="50" y2="18" stroke={C.goldLite} strokeWidth="5" strokeLinecap="round" transform={`rotate(${f * 6} 50 50)`} />
    <line x1="50" y1="50" x2="72" y2="50" stroke={C.gold} strokeWidth="6" strokeLinecap="round" transform={`rotate(${f * 0.5} 50 50)`} />
  </svg>);

const Notebook: React.FC<{ f: number }> = ({ f }) => {
  const pulse = 1 + 0.06 * Math.sin(f / 4);
  return (<div style={{ position: "absolute", left: 300, top: 430, width: 480, height: 600, borderRadius: 24, background: "#F4F0E6",
    transform: `rotate(-4deg) scale(${pulse})`, boxShadow: `0 0 ${40 + 30 * Math.sin(f / 4)}px ${C.red}` }}>
    {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ margin: "60px 50px 0", height: 10, borderRadius: 5, background: "rgba(27,42,68,0.25)" }} />)}
  </div>);
};

const GoldDog: React.FC<{ f: number; logo: string }> = ({ f, logo }) => { const s = sp(f); return (
  <div style={{ position: "absolute", left: 340, top: 380 - 40 * s, width: 400, height: 400, borderRadius: 999,
    background: `radial-gradient(circle at 38% 32%, ${C.goldLite}, ${C.gold} 58%, ${C.goldDeep})`, display: "flex",
    alignItems: "center", justifyContent: "center", transform: `scale(${s})`, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
    <Img src={staticFile(logo)} style={{ width: 330, height: 330 }} />
  </div>); };

export const KyloExamSimulatorMaster: React.FC<SimProps> = ({ sceneFrames, screens, logo }) => {
  const frames = sceneFrames ?? SIM_DESIGN_FRAMES; const r = sceneRanges(frames); const D = SIM_DESIGN_FRAMES;
  if (!Array.isArray(screens) || screens.length !== 4) throw new Error("screens_invalid");
  const frame = useCurrentFrame(); const [o0, o1] = r[6]; const blackStart = o0 + Math.round((o1 - o0) * 0.55);
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <Bg />
      <Scene range={r[0]} design={D[0]}>{(f) => <Clock f={f} />}</Scene>
      <Scene range={r[1]} design={D[1]}>{(f) => <Notebook f={f} />}</Scene>
      <Scene range={r[2]} design={D[2]}>{(f) => <Phone src={screens[0]} f={f} scroll={ci(f, [30, 130], [0, 500])} />}</Scene>
      <Scene range={r[3]} design={D[3]}>{(f) => (
        <div style={{ position: "absolute", left: 65, top: 520, width: 885, transform: `scale(${0.9 + 0.1 * sp(f)})`,
          borderRadius: 28, overflow: "hidden", boxShadow: `0 0 ${30 + 20 * Math.sin(f / 5)}px ${C.gold}` }}>
          <Img src={staticFile(screens[1])} style={{ width: "100%" }} /></div>)}</Scene>
      <Scene range={r[4]} design={D[4]}>{(f) => <Phone src={screens[2]} f={f} scroll={ci(f, [20, 115], [0, 420])} />}</Scene>
      <Scene range={r[5]} design={D[5]}>{(f) => <Phone src={screens[3]} f={f} scroll={ci(f, [40, 115], [0, 260])} />}</Scene>
      {frame >= o0 && frame < blackStart && <AbsoluteFill><GoldDog f={frame - o0} logo={logo} /></AbsoluteFill>}
      {frame >= blackStart && frame < o1 && (
        <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center" }}>
          <Img src={staticFile(logo)} style={{ width: 240, height: 240, marginTop: -160, opacity: ci(frame - blackStart, [0, 12], [0, 1]) }} />
        </AbsoluteFill>)}
    </AbsoluteFill>);
};
