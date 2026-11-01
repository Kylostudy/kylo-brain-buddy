// Kylo exam-promo (IELTS) 9:16 renderer composition.
// Data-driven: all localized copy, beat timing, captions and assets come from the
// recipe request (props). Visual arc matches the approved German master video:
// chat apps -> exam reveal -> stamp -> official simulation -> marking key ->
// 190+ exams -> 3-month refresh -> vocab trainer -> gold dog CTA -> black outro.
import React from "react";
import { BrandTail } from "./BrandTail";
import { CAPTION_LAYOUT } from "./captionSafeZone";
import { IELTS_PROFILE, type ExamProfile } from "./examProfiles";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  continueRender,
  cancelRender,
  delayRender,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface Beat {
  id: string;
  t0: number;
  t1: number;
}
export interface Sub {
  t0: number;
  t1: number;
  text: string;
}
export interface PromoProps {
  [k: string]: unknown;
  lang: string;
  beats: Beat[]; // 10 beats, ms: chat, exam, stamp, sim, score, exams, fresh, vocab, cta, outro
  subs: Sub[];
  narration: Record<string, string>;
  strings: Record<string, string>;
  telegram: string | null;
  font?: { file: string; family: string };
  examProfile?: ExamProfile;
  assets: { vo: string; bed: string; stinger: string; dog: string; tail: string };
}

const C = {
  bg: "#0B0803",
  panel: "#17120C",
  panelHi: "#1D170E",
  border: "rgba(233,180,76,0.25)",
  gold: "#E9B44C",
  goldLite: "#FFE3A3",
  goldDeep: "#8F691B",
  ink: "#171004",
  text: "#F5EFE2",
  muted: "rgba(245,239,226,0.55)",
  dim: "rgba(245,239,226,0.28)",
  red: "#E4574F",
  green: "#8FCE9B",
  purple: "#8B7CF6",
  purpleLite: "#CFC5FF",
  blue: "#5B8DEF",
};

const FONT =
  'var(--recipe-font, "Nunito"), "Nunito", "Noto Sans", sans-serif';

const FONT_FILES: { file: string; family: string; weight: string }[] = [
  { file: "fonts/nunito-var.ttf", family: "Nunito", weight: "200 1000" },
  { file: "fonts/notosans-var.ttf", family: "Noto Sans", weight: "200 1000" },
];

const fontsStarted = new Set<string>();
function ensureFonts(font?: PromoProps["font"]) {
  const key = font ? `${font.family}:${font.file}` : "legacy";
  if (fontsStarted.has(key)) return;
  fontsStarted.add(key);
  const handle = delayRender("loading-fonts");
  Promise.all(
    [...FONT_FILES, ...(font ? [{ ...font, weight: "100 900" }] : [])].map(
      (f) =>
        new Promise<void>((resolve, reject) => {
          const ff = new FontFace(f.family, `url(${staticFile(f.file)})`, { weight: f.weight });
          ff.load().then(() => {
            document.fonts.add(ff);
            resolve();
          }, reject);
        })
    )
  ).then(
    () => continueRender(handle),
    (error) => cancelRender(error)
  );
}

// ---------- helpers ----------
const l = (v: number, from: number, to: number) => Math.max(0, Math.min(1, (v - from) / (to - from)));

function useNow() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (frame / fps) * 1000; // ms
}

function Dust() {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: 70 }, (_, i) => ({
    x: random(`x${i}`) * 100,
    y0: random(`y${i}`) * 100,
    s: 1 + random(`s${i}`) * 2.6,
    sp: 0.4 + random(`v${i}`) * 0.9,
    tw: random(`t${i}`) * Math.PI * 2,
  }));
  return (
    <AbsoluteFill>
      {dots.map((d, i) => {
        const y = (d.y0 - frame * d.sp * 0.012 + 100) % 100;
        const op = 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(frame * 0.05 + d.tw));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${d.x}%`,
              top: `${y}%`,
              width: d.s,
              height: d.s,
              borderRadius: 99,
              background: C.goldLite,
              opacity: op,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function Backdrop() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 55% at 50% -8%, rgba(233,180,76,0.10), transparent 60%), radial-gradient(90% 50% at 50% 108%, rgba(233,180,76,0.06), transparent 60%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(rgba(233,180,76,0.10) 1px, transparent 1.4px)",
          backgroundSize: "46px 46px",
          opacity: 0.5,
        }}
      />
      <Dust />
    </AbsoluteFill>
  );
}

const Panel: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div
    style={{
      background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
      border: `1.5px solid ${C.border}`,
      borderRadius: 34,
      boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
      ...style,
    }}
  >
    {children}
  </div>
);

const Kicker: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => (
  <div
    dir="auto"
    style={{
      color: C.gold,
      fontSize: 30,
      fontWeight: 800,
      letterSpacing: 6,
      textTransform: "uppercase",
      fontFamily: FONT,
      ...style,
    }}
  >
    {text}
  </div>
);

function Caption({ now, subs }: { now: number; subs: Sub[] }) {
  const cur = subs.find((s) => now >= s.t0 && now <= s.t1);
  if (!cur) return null;
  const p = l(now, cur.t0, cur.t0 + 140);
  const out = l(now, cur.t1 - 120, cur.t1);
  return (
    <div
      style={{
        position: "absolute",
        left: CAPTION_LAYOUT.left,
        right: CAPTION_LAYOUT.rightInset,
        bottom: CAPTION_LAYOUT.bottomInset,
        display: "flex",
        justifyContent: "center",
        padding: 0,
        opacity: p * (1 - out),
        transform: `translateY(${(1 - p) * 14}px)`,
      }}
    >
      <div
        dir="auto"
        style={{
          padding: "12px 16px",
          textAlign: "center",
          maxWidth: "100%",
          maxHeight: CAPTION_LAYOUT.maxHeight,
          overflowWrap: "anywhere",
          textShadow: "0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        <span
          style={{
            color: "#FFFFFF",
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1.25,
            fontFamily: FONT,
          }}
        >
          {cur.text}
        </span>
      </div>
    </div>
  );
}

const BUBBLES = [
  { t: 0.22, bg: "#F3EDE0", color: C.ink, text: "Hi! How was your day?", x: 90, y: 700, align: "flex-start" as const },
  { t: 0.44, bg: C.green, color: "#12291A", text: "Great, thanks! And you?", x: 210, y: 880, align: "flex-end" as const },
  { t: 0.64, bg: C.purpleLite, color: "#241A4D", text: "Pretty relaxed. Tell me more!", x: 60, y: 1060, align: "flex-start" as const },
];

function SceneChat({ b, now, strings }: { b: Beat; now: number; strings: Record<string, string> }) {
  const p = l(now, b.t0, b.t1);
  return (
    <AbsoluteFill>
      <Kicker text={strings.kicker1} style={{ position: "absolute", top: 250, width: "100%", textAlign: "center", opacity: l(p, 0, 0.08) }} />
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 300,
          width: "100%",
          textAlign: "center",
          color: C.text,
          fontSize: 84,
          fontWeight: 900,
          fontFamily: FONT,
          opacity: l(p, 0.04, 0.14),
          transform: `translateY(${(1 - l(p, 0.04, 0.14)) * 20}px)`,
        }}
      >
        {strings.hook}
      </div>
      {[
        { x: 120, y: 500, size: 108, bg: C.purple, label: "Aa", ph: 0 },
        { x: 790, y: 440, size: 96, bg: "#E4764F", label: "?!", ph: 2 },
        { x: 110, y: 1160, size: 100, bg: "#57B364", label: "ABC", ph: 4 },
        { x: 810, y: 1130, size: 92, bg: C.blue, label: "✦", ph: 6 },
      ].map((ic, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: ic.x,
            top: ic.y + Math.sin(p * 6 + ic.ph) * 10,
            width: ic.size,
            height: ic.size,
            borderRadius: 26,
            background: ic.bg,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: ic.size * 0.36,
            fontWeight: 900,
            fontFamily: FONT,
            boxShadow: `0 16px 34px ${ic.bg}55`,
            opacity: l(p, 0.02 + i * 0.03, 0.12 + i * 0.03),
          }}
        >
          {ic.label}
        </div>
      ))}
      {BUBBLES.map((bb, i) => {
        const a = l(p, bb.t, bb.t + 0.1);
        return (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, top: bb.y, display: "flex", justifyContent: bb.align, padding: "0 70px", opacity: a, transform: `translateY(${(1 - a) * 18}px)` }}>
            <div
              dir="auto"
              style={{
                background: bb.bg,
                color: bb.color,
                borderRadius: 30,
                borderBottomRightRadius: bb.align === "flex-end" ? 8 : 30,
                borderBottomLeftRadius: bb.align === "flex-start" ? 8 : 30,
                padding: "22px 36px",
                fontSize: 38,
                fontWeight: 700,
                fontFamily: FONT,
                maxWidth: 760,
                boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
              }}
            >
              {bb.text}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function ExamArt({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  const badgeA = l(p, 0.02, 0.1);
  const ghostA = l(p, 0.12, 0.22);
  const strikeA = l(p, 0.42, 0.52);
  const examA = l(p, 0.5, 0.62);
  const cardA = l(p, 0.2, 0.32);
  const shown = profile.timerSeconds - Math.min(5, Math.floor((now - b.t0) / 1000));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <>
      <div style={{ position: "absolute", top: 250, width: "100%", display: "flex", justifyContent: "center", opacity: badgeA }}>
        <div style={{ background: C.gold, color: C.ink, borderRadius: 999, padding: "14px 34px", fontSize: 34, fontWeight: 900, fontFamily: FONT }}>{profile.name}</div>
      </div>
      <div style={{ position: "absolute", top: 420, width: "100%", textAlign: "center" }}>
        <span
          dir="auto"
          style={{
            color: C.dim,
            fontSize: 92,
            fontWeight: 800,
            fontFamily: FONT,
            opacity: ghostA,
            position: "relative",
            display: "inline-block",
          }}
        >
          {strings.ghost}
          <span
            style={{
              position: "absolute",
              left: "-4%",
              top: "50%",
              width: `${strikeA * 110}%`,
              height: 10,
              background: C.red,
              borderRadius: 6,
              transform: "translateY(-50%)",
            }}
          />
        </span>
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 560,
          width: "100%",
          textAlign: "center",
          color: C.gold,
          fontSize: 128,
          fontWeight: 900,
          fontFamily: FONT,
          opacity: examA,
          transform: `translateY(${(1 - examA) * 26}px)`,
          textShadow: "0 10px 44px rgba(233,180,76,0.35)",
        }}
      >
        {strings.examWord}
      </div>
      <Panel style={{ position: "absolute", left: 90, right: 90, top: 940, padding: "36px 42px", opacity: cardA, transform: `translateY(${(1 - cardA) * 24}px)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: C.gold, fontSize: 24, fontWeight: 800, fontFamily: FONT, maxWidth: 580 }}>{profile.taskHeading}</span>
          <span style={{ color: C.red, fontSize: 40, fontWeight: 900, fontFamily: FONT }}>{mmss(shown)}</span>
        </div>
        <div
          dir="auto"
          style={{ marginTop: 26, color: C.text, fontSize: 37, fontWeight: 700, lineHeight: 1.35, fontFamily: FONT }}
        >
          {profile.taskPrompt}
        </div>
        {[1, 0.82, 0.62].map((w, i) => (
          <div key={i} style={{ marginTop: 20, height: 18, borderRadius: 9, width: `${w * 100}%`, background: "rgba(245,239,226,0.14)" }} />
        ))}
      </Panel>
    </>
  );
}

function SceneExam({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  return (
    <AbsoluteFill>
      <ExamArt b={b} now={now} strings={strings} profile={profile} />
    </AbsoluteFill>
  );
}

function SceneStamp({ b, prev, now, strings, profile }: { b: Beat; prev: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  const punch = spring({ frame: (now - b.t0) / 1000 * 30, fps: 30, config: { damping: 9, mass: 0.7 }, durationInFrames: 18 });
  const shake = Math.sin(p * 40) * Math.exp(-p * 8) * 8;
  return (
    <AbsoluteFill style={{ transform: `translateX(${shake}px)` }}>
      <ExamArt b={prev} now={now} strings={strings} profile={profile} />
      <div
        style={{
          position: "absolute",
          left: 170,
          top: 1460,
          transform: `rotate(-8deg) scale(${1.5 - 0.5 * punch})`,
          opacity: Math.min(1, punch * 1.6),
          border: `7px solid ${C.red}`,
          borderRadius: 22,
          padding: "18px 46px",
          background: "rgba(23,10,9,0.55)",
        }}
      >
        <span dir="auto" style={{ color: C.red, fontSize: 64, fontWeight: 900, letterSpacing: 5, fontFamily: FONT }}>
          {strings.stamp}
        </span>
      </div>
    </AbsoluteFill>
  );
}

function SceneSim({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: 220, width: "100%", display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 999,
            background: "#100B06",
            border: `3px solid ${C.gold}`,
            boxShadow: "0 0 46px rgba(233,180,76,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            opacity: l(p, 0, 0.08),
          }}
        >
          <Img src={staticFile("assets/kylo-dog.png")} style={{ width: 124, height: 124 }} />
        </div>
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 402,
          width: "100%",
          textAlign: "center",
          color: C.text,
          fontSize: 64,
          fontWeight: 900,
          fontFamily: FONT,
          opacity: l(p, 0.05, 0.13),
        }}
      >
        {strings.simHeading}
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 496,
          width: "100%",
          textAlign: "center",
          color: C.gold,
          fontSize: 34,
          fontWeight: 800,
          fontFamily: FONT,
          opacity: l(p, 0.08, 0.16),
        }}
      >
        {strings.simSub}
      </div>
      <Panel style={{ position: "absolute", left: 90, right: 90, top: 640, padding: "34px 40px", opacity: l(p, 0.12, 0.2) }}>
        <div style={{ color: C.gold, fontSize: 26, fontWeight: 800, letterSpacing: 3, fontFamily: FONT }}>
          {profile.id === "ielts-academic" ? <>IELTS · 165 <span dir="auto">{strings.minutes}</span></> : profile.name}
        </div>
        <div style={{ marginTop: 18 }}>
          {profile.skills.map(([name, dur], i) => {
            const at = 0.3 + i * 0.16;
            const active = p > at;
            const check = spring({ frame: (p - at) * 600, fps: 30, durationInFrames: 16, config: { damping: 10 } });
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 22,
                  padding: "22px 26px",
                  marginTop: i ? 14 : 0,
                  borderRadius: 20,
                  background: active ? "rgba(233,180,76,0.10)" : "rgba(245,239,226,0.05)",
                  border: `1.5px solid ${active ? "rgba(233,180,76,0.4)" : "rgba(245,239,226,0.08)"}`,
                  opacity: l(p, at - 0.06, at),
                }}
              >
                <span style={{ color: C.text, fontSize: name.length > 18 ? 30 : 38, fontWeight: 800, fontFamily: FONT, flex: 1, textAlign: "left", minWidth: 0 }}>{name}</span>
                <span style={{ color: C.muted, fontSize: 30, fontWeight: 700, fontFamily: FONT }}>
                  {dur} <span dir="auto">{strings.minutes}</span>
                </span>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 999,
                    background: active ? C.gold : "transparent",
                    border: `2px solid ${active ? C.gold : "rgba(245,239,226,0.25)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {active && (
                    <svg viewBox="0 0 24 24" style={{ width: 26, opacity: check }}>
                      <path d="M4 12.5L9.5 18L20 6.5" fill="none" stroke={C.ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </AbsoluteFill>
  );
}

const SCORES: [string, number, number][] = [
  ["Listening", 82, 82],
  ["Reading", 74, 76],
  ["Writing", 55, 68],
  ["Speaking", 27, 71],
];

function SceneScore({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  const ringP = l(p, 0.55, 0.92);
  const ringVal = Math.round(ringP * 74);
  return (
    <AbsoluteFill>
      <Kicker text={strings.keyKicker} style={{ position: "absolute", top: 250, width: "100%", textAlign: "center", opacity: l(p, 0, 0.08) }} />
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 296,
          width: "100%",
          textAlign: "center",
          color: C.text,
          fontSize: 76,
          fontWeight: 900,
          fontFamily: FONT,
          opacity: l(p, 0.04, 0.12),
        }}
      >
        {strings.keyWord}
      </div>
      <Panel style={{ position: "absolute", left: 90, right: 90, top: 470, padding: "40px 42px", opacity: l(p, 0.12, 0.2) }}>
        {SCORES.map(([, low, high], i) => {
          const name = profile.scoreLabels[i];
          const at = 0.2 + i * 0.07;
          const early = interpolate(p, [at, at + 0.18], [0, low], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const late = interpolate(p, [0.5, 0.68], [low, high], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const val = Math.round(p < 0.5 ? early : late);
          return (
            <div key={i} style={{ marginTop: i ? 30 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: C.text, fontSize: 30, fontWeight: 800, fontFamily: FONT }}>{name}</span>
                <span style={{ color: C.gold, fontSize: 35, fontWeight: 900, fontFamily: FONT }}>{val}%</span>
              </div>
              <div style={{ marginTop: 10, height: 26, borderRadius: 13, background: "rgba(233,180,76,0.13)", overflow: "hidden" }}>
                <div style={{ width: `${val}%`, height: "100%", borderRadius: 13, background: `linear-gradient(90deg, ${C.goldDeep}, ${C.gold} 70%, ${C.goldLite})` }} />
              </div>
            </div>
          );
        })}
      </Panel>
      <div style={{ position: "absolute", top: 1080, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", opacity: l(p, 0.5, 0.6) }}>
        <div style={{ position: "relative", width: 320, height: 320 }}>
          <svg viewBox="0 0 120 120" style={{ width: 320, height: 320, transform: "rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(233,180,76,0.15)" strokeWidth="9" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={C.gold} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${ringP * 2 * Math.PI * 52} 999`} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: C.gold, fontSize: 92, fontWeight: 900, fontFamily: FONT }}>{ringVal}%</span>
            <span dir="auto" style={{ color: C.muted, fontSize: 30, fontWeight: 700, fontFamily: FONT }}>{strings.resultLabel}</span>
          </div>
        </div>
        <Kicker text={strings.resultKicker} style={{ marginTop: 26, fontSize: 26, letterSpacing: 5, opacity: l(p, 0.72, 0.82) }} />
      </div>
    </AbsoluteFill>
  );
}

const CHIPS: { t: string; x: number; y: number; at: number }[] = [
  { t: "IELTS Academic", x: 30, y: 420, at: 0.08 },
  { t: "TOEFL iBT", x: 700, y: 400, at: 0.12 },
  { t: "Cambridge C1", x: 40, y: 950, at: 0.2 },
  { t: "telc B2", x: 640, y: 930, at: 0.24 },
  { t: "DELF B2", x: 120, y: 1050, at: 0.28 },
  { t: "Goethe C1", x: 660, y: 1040, at: 0.32 },
  { t: "TestDaF", x: 200, y: 1150, at: 0.36 },
  { t: "DELE B2", x: 560, y: 1160, at: 0.4 },
  { t: "CILS B2", x: 60, y: 1250, at: 0.44 },
];

function SceneExams({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  const count = Math.round(interpolate(p, [0.3, 0.6], [134, 190], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <AbsoluteFill>
      <Kicker text={strings.notOnlyKicker} style={{ position: "absolute", top: 250, width: "100%", textAlign: "center", opacity: l(p, 0, 0.08) }} />
      {CHIPS.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: c.x,
            top: c.y + Math.sin(p * 5 + i) * 8,
            opacity: l(p, c.at, c.at + 0.06) * (0.9 + 0.1 * Math.sin(i * 2)),
            border: "1.5px solid rgba(233,180,76,0.35)",
            background: "rgba(23,17,9,0.7)",
            borderRadius: 999,
            padding: "14px 30px",
          }}
        >
          <span style={{ color: i === 0 ? C.goldLite : C.text, fontSize: 28, fontWeight: 700, fontFamily: FONT }}>{i === 0 ? profile.name : c.t}</span>
        </div>
      ))}
      {[strings.examChip1, strings.examChip2].map((t, i) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: i ? 600 : 210,
            top: i ? 1350 : 1245,
            opacity: l(p, 0.5 + i * 0.04, 0.56 + i * 0.04),
            border: "1.5px solid rgba(233,180,76,0.35)",
            background: "rgba(23,17,9,0.7)",
            borderRadius: 999,
            padding: "14px 30px",
          }}
        >
          <span dir="auto" style={{ color: C.text, fontSize: 28, fontWeight: 700, fontFamily: FONT }}>
            {t}
          </span>
        </div>
      ))}
      <div style={{ position: "absolute", top: 560, width: "100%", textAlign: "center" }}>
        <div dir="auto" style={{ color: C.text, fontSize: 52, fontWeight: 800, fontFamily: FONT, opacity: l(p, 0.24, 0.3) }}>{strings.moreThan}</div>
        <div style={{ color: C.gold, fontSize: 190, fontWeight: 900, fontFamily: FONT, textShadow: "0 12px 50px rgba(233,180,76,0.35)", opacity: l(p, 0.28, 0.36) }}>
          {count}+
        </div>
        <div dir="auto" style={{ color: C.text, fontSize: 62, fontWeight: 800, fontFamily: FONT, opacity: l(p, 0.36, 0.44) }}>{strings.notOnlyWord}</div>
      </div>
    </AbsoluteFill>
  );
}

function SceneFresh({ b, now, strings }: { b: Beat; now: number; strings: Record<string, string> }) {
  const p = l(now, b.t0, b.t1);
  const arc = l(p, 0.12, 0.5);
  return (
    <AbsoluteFill>
      <Kicker text={strings.freshKicker} style={{ position: "absolute", top: 280, width: "100%", textAlign: "center", opacity: l(p, 0, 0.08) }} />
      <div style={{ position: "absolute", top: 400, width: "100%", display: "flex", justifyContent: "center", opacity: l(p, 0.06, 0.14) }}>
        <div style={{ position: "relative", width: 300, height: 300 }}>
          <svg viewBox="0 0 120 120" style={{ width: 300, height: 300, transform: "rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(233,180,76,0.15)" strokeWidth="7" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={C.gold} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${arc * 2 * Math.PI * 52} 999`} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
            <span
              dir="auto"
              style={{
                color: C.text,
                fontSize: (strings.months || "").length <= 8 ? 104 : 64,
                fontWeight: 900,
                fontFamily: FONT,
                textAlign: "center",
              }}
            >
              {strings.months}
            </span>
          </div>
        </div>
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 780,
          width: "100%",
          textAlign: "center",
          color: C.text,
          fontSize: 66,
          fontWeight: 800,
          fontFamily: FONT,
          opacity: l(p, 0.2, 0.28),
        }}
      >
        {strings.freshWord}
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 890,
          width: "100%",
          textAlign: "center",
          color: C.gold,
          fontSize: 44,
          fontWeight: 800,
          fontFamily: FONT,
          opacity: l(p, 0.5, 0.6),
        }}
      >
        {strings.freshNote}
      </div>
    </AbsoluteFill>
  );
}

function VocabCard({ p, phase, strings, profile }: { p: number; phase: number; strings: Record<string, string>; profile: ExamProfile }) {
  const flipAt = phase === 0 ? 0.6 : 0.45;
  const flip = l(p, flipAt, flipAt + 0.09);
  const scale = Math.abs(Math.cos(flip * Math.PI));
  const flipped = flip > 0.5;
  const goldCard = flipped;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: 820,
          height: 500,
          borderRadius: 40,
          transform: `scaleX(${Math.max(0.02, scale)})`,
          background: goldCard
            ? `linear-gradient(160deg, ${C.goldLite}, ${C.gold} 55%, ${C.goldDeep})`
            : `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
          border: `1.5px solid ${goldCard ? C.goldLite : C.border}`,
          boxShadow: "0 30px 70px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
        }}
      >
        {!goldCard ? (
          <>
            <span style={{ color: C.gold, fontSize: 30, fontWeight: 800, letterSpacing: 5, fontFamily: FONT }}>
              {strings.wordLabel} {phase + 1} / 3
            </span>
            <span style={{ color: C.text, fontSize: 84, fontWeight: 900, fontFamily: FONT }}>{profile.vocabulary[phase]}</span>
            <span dir="auto" style={{ color: C.dim, fontSize: 28, fontWeight: 700, fontFamily: FONT }}>{strings.flipHint}</span>
          </>
        ) : (
          <>
            <span dir="auto" style={{ color: C.ink, fontSize: 64, fontWeight: 900, fontFamily: FONT, textAlign: "center", padding: "0 40px" }}>
              {phase === 0 ? strings.vocabLocal1 : strings.vocabLocal2}
            </span>
            <div style={{ background: "rgba(23,16,4,0.9)", color: C.goldLite, borderRadius: 999, padding: "12px 30px", fontSize: 30, fontWeight: 800, fontFamily: FONT }}>
              ✓ <span dir="auto">{strings.knownLabel}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SceneVocab({ b, now, strings, profile }: { b: Beat; now: number; strings: Record<string, string>; profile: ExamProfile }) {
  const p = l(now, b.t0, b.t1);
  const bar1 = interpolate(p, [0.55, 0.68], [7, 36], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bar2 = interpolate(p, [0.85, 0.95], [36, 64], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const phase = p < 0.52 ? 0 : 1;
  const pct = phase === 0 ? Math.round(bar1) : Math.round(bar2);
  return (
    <AbsoluteFill>
      <Kicker text={strings.vocabKicker} style={{ position: "absolute", top: 250, width: "100%", textAlign: "center", opacity: l(p, 0, 0.06) }} />
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 296,
          width: "100%",
          textAlign: "center",
          color: C.text,
          fontSize: 72,
          fontWeight: 900,
          fontFamily: FONT,
          opacity: l(p, 0.04, 0.1),
        }}
      >
        {strings.vocabTitle}
      </div>
      <div style={{ position: "absolute", top: 460, width: "100%" }}>
        <VocabCard p={phase === 0 ? p : p - 0.52} phase={phase} strings={strings} profile={profile} />
      </div>
      <Panel style={{ position: "absolute", left: 90, right: 90, top: 1080, padding: "30px 38px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span dir="auto" style={{ color: C.text, fontSize: 32, fontWeight: 800, fontFamily: FONT }}>{strings.vocabTitle}</span>
          <span style={{ color: C.gold, fontSize: 32, fontWeight: 900, fontFamily: FONT }}>{pct}%</span>
        </div>
        <div style={{ marginTop: 14, height: 20, borderRadius: 10, background: "rgba(233,180,76,0.13)" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 10, background: `linear-gradient(90deg, ${C.goldDeep}, ${C.gold}, ${C.goldLite})` }} />
        </div>
      </Panel>
    </AbsoluteFill>
  );
}

function SceneCta({ b, now, strings }: { b: Beat; now: number; strings: Record<string, string> }) {
  const p = l(now, b.t0, b.t1);
  const rise = spring({ frame: (now - b.t0) / 1000 * 30, fps: 30, durationInFrames: 26, config: { damping: 11, mass: 0.9 } });
  return (
    <AbsoluteFill style={{ background: "#070502" }}>
      <BrandTail />
      <div style={{ position: "absolute", top: 300, width: "100%", display: "flex", justifyContent: "center" }}>
        <Img
          src={staticFile("assets/kylo-dog.png")}
          style={{
            width: 460,
            height: 460,
            transform: `translateY(${(1 - rise) * 120}px)`,
            filter: "sepia(1) saturate(2.6) hue-rotate(-12deg) brightness(1.05) drop-shadow(0 20px 60px rgba(233,180,76,0.4))",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 810,
          width: "100%",
          textAlign: "center",
          color: C.gold,
          fontSize: 150,
          fontWeight: 900,
          fontFamily: FONT,
          textShadow: "0 8px 60px rgba(233,180,76,0.5)",
          opacity: rise,
        }}
      >
        Kylo
      </div>
      <div style={{ position: "absolute", top: 1030, width: "100%", display: "flex", justifyContent: "center", opacity: l(p, 0.25, 0.4) }}>
        <div
          dir="auto"
          style={{
            background: `linear-gradient(180deg, ${C.goldLite}, ${C.gold})`,
            color: C.ink,
            borderRadius: 999,
            padding: "26px 56px",
            fontSize: 46,
            fontWeight: 900,
            fontFamily: FONT,
            boxShadow: "0 16px 50px rgba(233,180,76,0.45)",
          }}
        >
          {strings.ctaButton}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function SceneOutro({ b, now, strings, telegram }: { b: Beat; now: number; strings: Record<string, string>; telegram: string | null }) {
  const p = l(now, b.t0, b.t1);
  return (
    <AbsoluteFill style={{ background: "#020202" }}>
      <div style={{ position: "absolute", top: 380, width: "100%", display: "flex", justifyContent: "center", opacity: l(p, 0.04, 0.16) }}>
        <Img src={staticFile("assets/kylo-dog.png")} style={{ width: 430, height: 430 }} />
      </div>
      <div style={{ position: "absolute", top: 900, width: "100%", textAlign: "center", color: "#FFFFFF", fontSize: 96, fontWeight: 900, fontFamily: FONT, opacity: l(p, 0.14, 0.26) }}>
        kylo.study
      </div>
      <div
        dir="auto"
        style={{
          position: "absolute",
          top: 1040,
          width: "100%",
          textAlign: "center",
          color: C.gold,
          fontSize: 42,
          fontWeight: 800,
          fontFamily: FONT,
          opacity: l(p, 0.2, 0.32),
        }}
      >
        {strings.outroTagline}
      </div>
      {telegram && (
        <div style={{ position: "absolute", top: 1180, width: "100%", display: "flex", justifyContent: "center", opacity: l(p, 0.26, 0.38) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, background: "rgba(245,239,226,0.10)", border: "1.5px solid rgba(245,239,226,0.22)", borderRadius: 999, padding: "16px 34px" }}>
            <svg viewBox="0 0 24 24" style={{ width: 34 }}>
              <path fill="#F5EFE2" d="M21.6 3.2L2.9 10.4c-1 .4-1 1.8 0 2.2l4.6 1.5 1.7 5.3c.3.9 1.4 1.1 2 .4l2.5-2.6 4.7 3.5c.8.6 1.9.1 2.1-.8l3-15c.2-1-.9-1.9-1.9-1.7z" />
            </svg>
            <span style={{ color: "#F5EFE2", fontSize: 32, fontWeight: 800, fontFamily: FONT }}>{telegram}</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

export const IELTSPromo: React.FC<PromoProps> = (props) => {
  ensureFonts(props.font);
  const profile = props.examProfile ?? IELTS_PROFILE;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const now = (frame / fps) * 1000;
  const beats = props.beats;
  const b = (i: number) => beats[Math.min(i, beats.length - 1)];
  const dur = durationInFrames * (1000 / fps);
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, ...(props.font ? { "--recipe-font": `"${props.font.family}"` } : {}) } as React.CSSProperties}>
      <Backdrop />
      {now < b(1).t0 && <SceneChat b={b(0)} now={now} strings={props.strings} />}
      {now >= b(1).t0 && now < b(2).t0 && <SceneExam b={b(1)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(2).t0 && now < b(3).t0 && <SceneStamp b={b(2)} prev={b(1)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(3).t0 && now < b(4).t0 && <SceneSim b={b(3)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(4).t0 && now < b(5).t0 && <SceneScore b={b(4)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(5).t0 && now < b(6).t0 && <SceneExams b={b(5)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(6).t0 && now < b(7).t0 && <SceneFresh b={b(6)} now={now} strings={props.strings} />}
      {now >= b(7).t0 && now < b(8).t0 && <SceneVocab b={b(7)} now={now} strings={props.strings} profile={profile} />}
      {now >= b(8).t0 && now < b(9).t0 && <SceneCta b={b(8)} now={now} strings={props.strings} />}
      {now >= b(9).t0 && now < dur && <SceneOutro b={b(9)} now={now} strings={props.strings} telegram={props.telegram} />}
      <Caption now={now} subs={props.subs} />
      <Audio src={staticFile(props.assets.vo)} />
      <Audio src={staticFile(props.assets.bed)} volume={(f: number) => 0.16} />
      <Sequence from={Math.round((b(8).t0 / 1000) * fps)}>
        <Audio src={staticFile(props.assets.stinger)} volume={0.85} />
      </Sequence>
    </AbsoluteFill>
  );
};
