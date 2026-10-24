// QA root: registers the promo + the shared silent brand-tail composition.
// The production VPS entry renders IELTSPromo programmatically (see index.ts).
import React from "react";
import { Composition } from "remotion";
import { IELTSPromo, type PromoProps } from "./IELTSPromo";
import { BrandTail } from "./BrandTail";

const DEMO: PromoProps = {
  lang: "DE",
  beats: [
    { id: "chat", t0: 0, t1: 5200 },
    { id: "exam", t0: 5200, t1: 9600 },
    { id: "stamp", t0: 9600, t1: 12200 },
    { id: "sim", t0: 12200, t1: 19600 },
    { id: "score", t0: 19600, t1: 25200 },
    { id: "exams", t0: 25200, t1: 30600 },
    { id: "fresh", t0: 30600, t1: 35000 },
    { id: "vocab", t0: 35000, t1: 41900 },
    { id: "cta", t0: 41900, t1: 44800 },
    { id: "outro", t0: 44800, t1: 51200 },
  ],
  subs: [{ t0: 0, t1: 5000, text: "Mit Gemini und unzähligen Sprach-Apps kannst du locker auf Englisch plaudern." }],
  narration: {},
  strings: {
    kicker1: "KI-Chats & Sprach-Apps",
    hook: "Englisch plaudern?",
    ghost: "Plaudern",
    examWord: "Prüfung.",
    stamp: "GEPRÜFT",
    simHeading: "Kylo simuliert die Prüfung",
    simSub: "nach der offiziellen IELTS-Prüfungsordnung",
    keyKicker: "OFFIZIELLER",
    keyWord: "Bewertungsschlüssel",
    resultKicker: "BEISPIELERGEBNIS",
    resultLabel: "Gesamtergebnis",
    notOnlyKicker: "NICHT NUR IELTS",
    notOnlyWord: "Sprachprüfungen",
    moreThan: "Mehr als",
    freshKicker: "IMMER AKTUELL",
    freshWord: "Prüfungsordnungen",
    months: "3 Monate",
    freshNote: "automatisch aktualisiert",
    vocabKicker: "VOKABELTRAINER",
    vocabTitle: "IELTS-Wortschatz",
    wordLabel: "WORT",
    flipHint: "Tippen zum Umdrehen",
    knownLabel: "Gewusst",
    minutes: "Min",
    examChip1: "Spanisch B1",
    examChip2: "Englisch C1",
    vocabLocal1: "abmildern, lindern",
    vocabLocal2: "erheblich, beträchtlich",
    ctaButton: "Jetzt kostenlos testen",
    outroTagline: "Dein KI-Nachhilfelehrer",
  },
  telegram: "t.me/kylostudy_de",
  assets: { vo: "media/vo-DE.mp3", bed: "assets/bed.mp3", stinger: "assets/stinger.mp3", dog: "assets/kylo-dog.png", tail: "assets/brand-tail.mp4" },
};

export const Root: React.FC = () => (
  <>
    <Composition<any, PromoProps>
      id="IELTSPromo"
      component={IELTSPromo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={30}
      defaultProps={DEMO}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(((props.beats.at(-1)?.t1 ?? 1000) / 1000) * 30),
      })}
    />
    <Composition id="BrandTail" component={BrandTail} width={1080} height={1920} fps={30} durationInFrames={96} defaultProps={{}} />
  </>
);

