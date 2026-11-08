import React from "react";
import {validateSceneFrames} from "./timing";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";

/**
 * Kylo – „Malacpersely" első reklámpróba (9:16) — NÉMA, szövegmentes, nyelvsemleges master.
 * NEM RENDERELT. Kizárólag felülvizsgált helyi VPS-kiadásként telepíthető (infra/subject-factory /
 * video-factory supervisor szabályai szerint). Sandboxban/Lovable-ben render TILOS.
 *
 * 39 s @ 30 fps = 1170 frame, 7 jelenetablak. Minden olvasható szöveg (számláló, „100 USD/hó",
 * „29,99 USD/hó", pontosítás, CTA, kylo.study, „Your AI tutor") a magyar overlay-rétegben kerül rá
 * (overlay-hu.json), a Jessica-VO tényleges időzítéséhez igazítva. A master csak szimbólumokat mutat.
 * A sceneFrames prop a VO-igazításhoz tömöríti/nyújtja a jeleneteket (KyloIntroMaster mintájára).
 * Nincs alkalmazásmárka/logó a „versenytárs" érméken; a persely nem törik össze.
 */
export const PIGGY_FPS = 30;
export const PIGGY_WIDTH = 1080;
export const PIGGY_HEIGHT = 1920;

const C = {
  navy: "#0A1628", navyDeep: "#050C18", navyMid: "#12264A", navyLite: "#1D3866",
  paper: "#F4F0E6", paperShade: "#E2DBCB", ink: "#1B2A44", inkSoft: "rgba(27,42,68,0.28)",
  gold: "#E9B44C", goldLite: "#FFE3A3", goldDeep: "#A8791C",
  pig: "#F2A7B5", pigDeep: "#D97D90", pigLite: "#FFD3DC",
  red: "#E0524F", green: "#3FBF7F", text: "#E8EEF7", line: "rgba(200,212,230,0.16)",
};

// Tervezett jelenethosszak (frame) — a forgatókönyv 0–4–14–18–28–33–36–39 s határaihoz.
export const PIGGY_DESIGN_FRAMES = [120, 300, 120, 300, 150, 90, 90];
export type PiggyProps = { sceneFrames?: number[] };
export const piggyTotalFrames = (p: PiggyProps) => validateSceneFrames(p.sceneFrames ?? PIGGY_DESIGN_FRAMES).reduce((a, b) => a + b, 0);
export const PIGGY_DURATION_IN_FRAMES = piggyTotalFrames({});

const EO = Easing.out(Easing.cubic);
const EIO = Easing.inOut(Easing.cubic);
const ci = (f: number, i: number[], o: number[], easing?: (t: number) => number) =>
  interpolate(f, i, o, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
const sp = (f: number, damping = 12, stiffness = 130) => spring({ frame: f, fps: PIGGY_FPS, config: { damping, stiffness } });

const Scene: React.FC<{ range: number[]; design: number; fadeIn?: number; fadeOut?: number; children: (f: number) => React.ReactNode }> = ({
  range, design, fadeIn = 10, fadeOut = 10, children,
}) => {
  const frame = useCurrentFrame();
  const [start, end] = range;
  if (frame < start || frame >= end) return null;
  const local = frame - start;
  const edge = Math.min((end - start) / 3, 10);
  const opacity = (fadeIn ? Math.min(1, local / edge) : 1) * (fadeOut ? Math.min(1, (end - frame) / edge) : 1);
  const k = design / Math.max(1, end - start);
  return <AbsoluteFill style={{ opacity }}>{children((frame - start) * k)}</AbsoluteFill>;
};

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 1400px at 50% ${38 + Math.sin(frame / 90) * 3}%, ${C.navyMid}, ${C.navyDeep} 70%)` }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`, backgroundSize: "90px 90px", opacity: 0.35 }} />
    </AbsoluteFill>
  );
};

// ---- Öt nyelvsemleges tanulási eszköz-jelkép (márka nélkül) ----
type ToolKind = "note" | "cards" | "doc" | "lang" | "tools";
export const TOOLS: ToolKind[] = ["note", "cards", "doc", "lang", "tools"];
const ToolIcon: React.FC<{ kind: ToolKind; size: number; color?: string }> = ({ kind, size, color = C.ink }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
    {kind === "note" && (<><rect x="24" y="16" width="52" height="68" rx="6" /><path d="M34 36h32M34 50h32M34 64h20" /></>)}
    {kind === "cards" && (<><rect x="18" y="30" width="50" height="40" rx="6" transform="rotate(-10 43 50)" /><rect x="34" y="30" width="50" height="40" rx="6" /><path d="M52 50h14" /></>)}
    {kind === "doc" && (<><path d="M28 14h32l16 16v56H28z" /><path d="M60 14v16h16" /><path d="M38 52l8 8 16-18" /></>)}
    {kind === "lang" && (<><path d="M14 24h40v30H32l-10 10V54h-8z" /><path d="M46 46h40v30h-8v10L68 76H46z" /></>)}
    {kind === "tools" && (<><circle cx="50" cy="50" r="14" /><path d="M50 16v12M50 72v12M16 50h12M72 50h12M26 26l8 8M66 66l8 8M74 26l-8 8M34 66l-8 8" /></>)}
  </svg>
);

const Coin: React.FC<{ kind: ToolKind; size?: number }> = ({ kind, size = 170 }) => (
  <div style={{
    width: size, height: size, borderRadius: 999, display: "flex", justifyContent: "center", alignItems: "center",
    background: `radial-gradient(circle at 38% 32%, ${C.goldLite}, ${C.gold} 58%, ${C.goldDeep} 100%)`,
    boxShadow: `0 10px 30px rgba(0,0,0,0.35), inset 0 0 0 ${size * 0.05}px rgba(255,227,163,0.7)`,
  }}>
    <ToolIcon kind={kind} size={size * 0.56} />
  </div>
);

// ---- Malacpersely (SVG), squash = ütközési lapulás, heavy = 0..1 elnehezülés ----
const Piggy: React.FC<{ scale: number; tilt: number; squash: number; heavy: number; smile?: number }> = ({ scale, tilt, squash, heavy, smile = 0 }) => (
  <div style={{ transform: `scale(${scale}) rotate(${tilt}deg) scaleY(${1 - squash * 0.08}) scaleX(${1 + squash * 0.05})`, transformOrigin: "50% 90%" }}>
    <svg width="520" height="440" viewBox="0 0 520 440">
      <ellipse cx="260" cy="420" rx={170 + heavy * 50} ry="16" fill="rgba(0,0,0,0.35)" />
      {[150, 210, 310, 370].map((x, i) => <rect key={i} x={x - 22} y="330" width="44" height={70 - heavy * 14} rx="14" fill={C.pigDeep} />)}
      <ellipse cx="260" cy="250" rx={200 + heavy * 18} ry={150 + heavy * 10} fill={C.pig} />
      <ellipse cx="220" cy="200" rx="110" ry="60" fill={C.pigLite} opacity="0.45" />
      <path d="M150 120 L170 60 L215 108 Z" fill={C.pigDeep} />
      <path d="M330 108 L370 58 L380 122 Z" fill={C.pigDeep} />
      <rect x="215" y="104" width="90" height="16" rx="8" fill={C.ink} opacity="0.75" />
      <ellipse cx="455" cy="250" rx="52" ry="44" fill={C.pigDeep} />
      <circle cx="442" cy="246" r="8" fill={C.ink} /><circle cx="468" cy="246" r="8" fill={C.ink} />
      <circle cx="380" cy="200" r="11" fill={C.ink} />
      <path d={`M362 ${300 - smile * 4} Q382 ${300 + smile * 14} 402 ${300 - smile * 4}`} stroke={C.ink} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M62 240 q-30 -10 -22 -36 q10 -22 30 -6" stroke={C.pigDeep} strokeWidth="10" fill="none" strokeLinecap="round" />
    </svg>
  </div>
);

// Szöveg nélküli „terhelésmérő": 5 szegmens, a számokat az overlay adja.
const Gauge: React.FC<{ filled: number; flash?: number }> = ({ filled, flash = 0 }) => (
  <div style={{ display: "flex", gap: 14 }}>
    {TOOLS.map((_, i) => {
      const v = Math.max(0, Math.min(1, filled - i));
      return (
        <div key={i} style={{ width: 120, height: 34, borderRadius: 17, background: "rgba(255,255,255,0.08)", overflow: "hidden", boxShadow: `0 0 ${flash * 40}px rgba(224,82,79,${flash})` }}>
          <div style={{ width: `${v * 100}%`, height: "100%", background: i < 3 ? C.gold : C.red }} />
        </div>
      );
    })}
  </div>
);

const DROP = 60; // érmék közti távolság a 2. jelenetben (frame)
const piggyState = (coins: number, local: number) => {
  const impact = Math.max(0, 1 - local / 14) * (local >= 0 ? 1 : 0);
  return { scale: 0.78 + coins * 0.1, squash: impact, tilt: Math.sin(local / 3) * impact * 7, heavy: coins / 5 };
};

const FallingCoin: React.FC<{ kind: ToolKind; f: number; targetY: number }> = ({ kind, f, targetY }) => {
  if (f < -30 || f > 4) return null;
  const y = ci(f, [-30, 0], [-260, targetY], Easing.in(Easing.quad));
  const r = ci(f, [-30, 0], [-40, 0]);
  const s = ci(f, [-6, 2], [1, 0.25]);
  return <div style={{ position: "absolute", left: 540 - 85, top: y, transform: `rotate(${r}deg) scale(${s})` }}><Coin kind={kind} /></div>;
};

// =============== 1. Kis persely, első érme (0–4 s) ===============
const SceneHook: React.FC<{ f: number }> = ({ f }) => {
  const enter = sp(f - 4, 11, 120);
  const local = f - 70;
  const st = piggyState(local >= 0 ? 1 : 0, local);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: 790, opacity: ci(f, [70, 84], [0, 1]) }}><Gauge filled={ci(f, [70, 90], [0, 1], EO)} /></div>
      <FallingCoin kind="note" f={local} targetY={760} />
      <div style={{ position: "absolute", top: 820, transform: `translateY(${(1 - enter) * 500}px)` }}>
        <Piggy scale={0.78 + (local >= 0 ? 0.1 : 0) * ci(local, [0, 12], [0, 1])} tilt={st.tilt} squash={st.squash} heavy={st.heavy} />
      </div>
    </AbsoluteFill>
  );
};

// =============== 2. Díjak gyűlnek: további 4 érme (4–14 s) ===============
const SceneFees: React.FC<{ f: number }> = ({ f }) => {
  // 0. érme már bent van; 1..4 érkezik f = 30, 90, 150, 210-nél, utána 60 frame lecsengés
  const hits = [30, 90, 150, 210];
  const passed = hits.filter((h) => f >= h).length;
  const last = passed ? f - hits[passed - 1] : f + 100;
  const coins = 1 + passed;
  const grow = ci(last, [0, 14], [coins - 1, coins], EO);
  const st = piggyState(coins, last);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: 790 }}><Gauge filled={grow} flash={passed === 4 ? ci(last, [0, 10, 40], [0, 0.8, 0.3]) : 0} /></div>
      {hits.map((h, i) => <FallingCoin key={i} kind={TOOLS[i + 1]} f={f - h} targetY={760 - coins * 30} />)}
      {/* kis érme-sor: a már befizetett tételek jelképei a persely alatt */}
      <div style={{ position: "absolute", top: 1160, display: "flex", gap: 22 }}>
        {TOOLS.slice(0, coins).map((k, i) => <div key={k} style={{ transform: `scale(${i === coins - 1 ? ci(last, [0, 12], [0, 1], EO) : 1})` }}><Coin kind={k} size={110} /></div>)}
      </div>
      <div style={{ position: "absolute", top: 900 - grow * 20 }}>
        <Piggy scale={0.78 + grow * 0.1} tilt={st.tilt} squash={st.squash} heavy={grow / 5} />
      </div>
    </AbsoluteFill>
  );
};

// =============== 3. Az igazság pillanata + átrendeződés (14–18 s) ===============
const SceneTruth: React.FC<{ f: number }> = ({ f }) => {
  const wobble = Math.sin(f / 5) * ci(f, [0, 50], [2.5, 0]);
  const fly = ci(f, [56, 112], [0, 1], EIO); // jelképek kiemelkednek és sorba állnak
  const pigOut = ci(f, [56, 112], [0, 1], EIO);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      {/* üres hely a „100 USD/hó" overlaynek: y 300–480 */}
      <div style={{ position: "absolute", top: 820 - pigOut * 20, opacity: 1 - pigOut * 0.65 }}>
        <Piggy scale={1.28 - pigOut * 0.5} tilt={wobble} squash={0} heavy={1 - pigOut * 0.6} />
      </div>
      {TOOLS.map((k, i) => {
        const fromX = 540, fromY = 900;
        const toX = 540, toY = 820 + i * 110;
        const x = fromX + (toX - fromX) * fly + Math.sin((i + 1) * 1.7) * 260 * Math.sin(fly * Math.PI);
        const y = fromY + (toY - fromY) * fly;
        return <div key={k} style={{ position: "absolute", left: x - 70, top: y - 70, opacity: ci(f, [56, 66], [0, 1]) }}><Coin kind={k} size={140} /></div>;
      })}
      <svg style={{ position: "absolute", left: 0, top: 0 }} width="1080" height="1920">
        <line x1="540" y1="820" x2="540" y2={820 + 4 * 110 * ci(f, [100, 120], [0, 1])} stroke={C.gold} strokeWidth="8" strokeLinecap="round" opacity="0.8" />
      </svg>
    </AbsoluteFill>
  );
};

// ---- Absztrakt (szövegmentes) telefon-UI ----
const Bar: React.FC<{ w: number | string; h?: number; color?: string }> = ({ w, h = 16, color = C.inkSoft }) => (
  <div style={{ width: w, height: h, borderRadius: h, background: color, flexShrink: 0 }} />
);
const Phone: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: 640, height: 1180, borderRadius: 70, background: "#0B0F17", padding: 22, boxShadow: "0 40px 120px rgba(0,0,0,0.55), inset 0 0 0 3px #2A3242" }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 52, background: C.paper, overflow: "hidden", position: "relative" }}>{children}</div>
  </div>
);
const Step: React.FC<{ on: number; children: React.ReactNode }> = ({ on, children }) => (
  <AbsoluteFill style={{ opacity: on, transform: `translateY(${(1 - on) * 60}px)`, padding: 54, gap: 22 }}>{children}</AbsoluteFill>
);

// =============== 4. Egy jegyzet → magyarázat → kártya → vizsgakérdés (18–28 s) ===============
const SceneFlow: React.FC<{ f: number }> = ({ f }) => {
  const phoneIn = sp(f, 13, 110);
  const seg = (a: number, b: number) => ci(f, [a, a + 14, b - 10, b], [0, 1, 1, 0]);
  const s1 = seg(10, 80), s2 = seg(80, 150), s3 = seg(150, 215);
  const s4 = ci(f, [215, 229], [0, 1]);
  const flip = ci(f, [175, 195], [0, 180], EIO);
  const wrong = ci(f, [245, 252], [0, 1]);
  const right = ci(f, [262, 270], [0, 1]);
  const stepIdx = f < 80 ? 0 : f < 150 ? 1 : f < 215 ? 2 : 3;
  const flowIcons: ToolKind[] = ["note", "doc", "cards", "lang"];
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      {/* lépésjelző: 4 érme, az aktív kiemelve (a felső 240 px overlay-feliratnak fenntartva) */}
      <div style={{ position: "absolute", top: 470, display: "flex", gap: 30 }}>
        {flowIcons.map((k, i) => <div key={k} style={{ opacity: i <= stepIdx ? 1 : 0.3, transform: `scale(${i === stepIdx ? 1.12 : 0.9})` }}><Coin kind={k} size={100} /></div>)}
      </div>
      <div style={{ position: "absolute", top: 590, transform: `translateY(${(1 - phoneIn) * 900}px) scale(0.56)`, transformOrigin: "50% 0%" }}>
        <Phone>
          <Step on={s1}>{/* órai jegyzet */}
            <Bar w="60%" h={26} color={C.ink} />
            {[92, 84, 96, 70, 88, 76, 90, 64].map((w, i) => <Bar key={i} w={`${w * ci(f, [10 + i * 5, 24 + i * 5], [0, 1])}%`} />)}
          </Step>
          <Step on={s2}>{/* magyarázat: kiemelés + diagram */}
            <Bar w="50%" h={26} color={C.ink} />
            <div style={{ height: 300, borderRadius: 24, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 30 }}>
              {[0, 1, 2].map((i) => <div key={i} style={{ width: 110, height: 110, borderRadius: 999, background: [C.gold, C.green, C.navyLite][i], transform: `scale(${ci(f, [90 + i * 10, 104 + i * 10], [0, 1], EO)})` }} />)}
            </div>
            <Bar w="90%" color={C.gold} /><Bar w="80%" /><Bar w="86%" />
          </Step>
          <Step on={s3}>{/* tanulókártya fordítás */}
            <div style={{ marginTop: 160, height: 520, borderRadius: 36, background: flip < 90 ? "#fff" : C.gold, transform: `rotateY(${flip}deg)`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
              <Bar w="60%" h={28} color={C.ink} /><Bar w="40%" />
            </div>
          </Step>
          <Step on={s4}>{/* gyakorló vizsgakérdés: hibás, majd helyes válasz */}
            <Bar w="85%" h={24} color={C.ink} /><Bar w="70%" h={24} color={C.ink} />
            {[0, 1, 2, 3].map((i) => {
              const isWrong = i === 1, isRight = i === 2;
              const bg = isWrong ? `rgba(224,82,79,${wrong * 0.9})` : isRight ? `rgba(63,191,127,${right * 0.9})` : "transparent";
              return (
                <div key={i} style={{ height: 110, borderRadius: 24, border: `4px solid ${C.inkSoft}`, background: bg, display: "flex", alignItems: "center", padding: "0 28px", gap: 22 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 999, border: `4px solid ${C.ink}` }} />
                  <Bar w="60%" />
                  {isWrong && <svg width="50" height="50" viewBox="0 0 50 50" style={{ opacity: wrong }}><path d="M12 12l26 26M38 12L12 38" stroke="#fff" strokeWidth="7" strokeLinecap="round" /></svg>}
                  {isRight && <svg width="50" height="50" viewBox="0 0 50 50" style={{ opacity: right }}><path d="M10 26l10 10 20-22" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" /></svg>}
                </div>
              );
            })}
            <div style={{ opacity: ci(f, [272, 284], [0, 1]), height: 120, borderRadius: 24, background: "#fff", padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
              <Bar w="70%" color={C.green} /><Bar w="50%" />
            </div>
          </Step>
        </Phone>
      </div>
    </AbsoluteFill>
  );
};

const KyloBadge: React.FC<{ size: number; glow?: number }> = ({ size, glow = 0.5 }) => (
  <div style={{
    width: size, height: size, borderRadius: 999, overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "center",
    background: `radial-gradient(circle at 40% 35%, ${C.goldLite}, ${C.gold} 60%, ${C.goldDeep} 100%)`,
    boxShadow: `0 0 ${size * 0.4}px rgba(233,180,76,${glow}), inset 0 0 0 ${size * 0.03}px rgba(255,227,163,0.6)`,
  }}>
    <Img src={staticFile("assets/kylo-dog.png")} style={{ width: size * 0.84, height: size * 0.84, marginTop: size * 0.03 }} />
  </div>
);

// =============== 5. Ajánlat: márkajel + üres ártábla (28–33 s) ===============
const SceneOffer: React.FC<{ f: number }> = ({ f }) => {
  const badge = sp(f - 4, 11, 120);
  const plate = sp(f - 18, 14, 120);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", top: 380, transform: `scale(${badge})` }}><KyloBadge size={360} glow={0.55} /></div>
      {/* ártábla: a „29,99 USD/hó" overlay helye (y ≈ 900–1100), stabil, nem villog */}
      <div style={{ position: "absolute", top: 880, width: 820, height: 240, borderRadius: 40, background: "rgba(255,255,255,0.06)", border: `4px solid ${C.gold}`, transform: `scale(${plate})` }} />
      {/* kicsi, könnyű, mosolygó persely — nem bántott, csak megkönnyebbült */}
      <div style={{ position: "absolute", top: 790, opacity: ci(f, [30, 50], [0, 1]) }}>
        <Piggy scale={0.42} tilt={Math.sin(f / 9) * 3} squash={0} heavy={0} smile={1} />
      </div>
    </AbsoluteFill>
  );
};

// =============== 6a. Megemelt arany kutya + CTA-hely (33–36 s) ===============
const SceneGoldDog: React.FC<{ f: number }> = ({ f }) => {
  const pop = sp(f, 9, 140);
  const tilt = ci(f, [0, 8, 16, 26, 36], [-14, 8, -5, 3, 0]);
  const shine = ci(f, [18, 48], [-120, 120]);
  return (
    <AbsoluteFill style={{ background: "#070D18", justifyContent: "center", alignItems: "center" }}>
      <div style={{
        position: "relative", width: 360, height: 360, borderRadius: 999, overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "center",
        transform: `translateY(${-190 + Math.sin(f / 10) * 8}px) scale(${pop * (1 + Math.sin(f / 8) * 0.06)}) rotate(${tilt}deg)`,
        background: "radial-gradient(circle at 40% 35%, #FFE7B0, #F5B33B 60%, #B97E17 100%)",
        boxShadow: "0 0 110px rgba(245,179,59,0.55), inset 0 0 0 10px rgba(255,231,176,0.55)",
      }}>
        <Img src={staticFile("assets/kylo-dog.png")} style={{ width: 300, height: 300, marginTop: 10 }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 90, left: `calc(50% + ${shine}%)`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0))", transform: "skewX(-20deg)" }} />
      </div>
      {/* „Próbáld ki ingyen." overlay-hely: a korong alatt, y ≈ 1080–1240 */}
    </AbsoluteFill>
  );
};

// =============== 6b. Fekete zárókép, normál kutyalogó (36–39 s) ===============
const SceneBlack: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ background: "#000", justifyContent: "center", alignItems: "center" }}>
    <Img src={staticFile("assets/kylo-dog.png")} style={{ width: 220, height: 220, marginTop: -160, opacity: ci(f, [0, 12], [0, 1]) }} />
    {/* kylo.study + „Your AI tutor" az overlay-rétegben, a logó alatt */}
  </AbsoluteFill>
);

export const KyloPiggyBankMaster: React.FC<PiggyProps> = ({ sceneFrames }) => {
  const lens = validateSceneFrames(sceneFrames ?? PIGGY_DESIGN_FRAMES);
  const R: number[][] = [];
  lens.reduce((acc, n) => { R.push([acc, acc + n]); return acc + n; }, 0);
  const D = PIGGY_DESIGN_FRAMES;
  return (
    <AbsoluteFill style={{ backgroundColor: C.navyDeep }}>
      <Background />
      <Scene range={R[0]} design={D[0]} fadeIn={0} fadeOut={0}>{(f) => <SceneHook f={f} />}</Scene>
      <Scene range={R[1]} design={D[1]} fadeIn={0} fadeOut={0}>{(f) => <SceneFees f={f} />}</Scene>
      <Scene range={R[2]} design={D[2]} fadeIn={0}>{(f) => <SceneTruth f={f} />}</Scene>
      <Scene range={R[3]} design={D[3]}>{(f) => <SceneFlow f={f} />}</Scene>
      <Scene range={R[4]} design={D[4]}>{(f) => <SceneOffer f={f} />}</Scene>
      <Scene range={R[5]} design={D[5]} fadeOut={0}>{(f) => <SceneGoldDog f={f} />}</Scene>
      <Scene range={R[6]} design={D[6]} fadeIn={8} fadeOut={0}>{(f) => <SceneBlack f={f} />}</Scene>
    </AbsoluteFill>
  );
};
