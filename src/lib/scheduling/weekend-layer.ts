// Hétvégi viselkedési réteg. A Kylogic adja az időpontot, a Brain csak
// IGAZÍT rajta, mindig a fiók SAJÁT helyi időzónája szerint:
//  - nap-típus szerinti ablak (H–P / Szo / V), fiókonként és hetente eltolt sávval
//  - soha nem kerek perc
//  - minimális szünet ugyanazon fiók posztjai között (hétvégén hosszabb)
//  - ugyanaz a fiók az előző 3 hét azonos napján ne posztoljon ±30 percen belül
//  - két különböző fiók ne posztoljon ugyanabban a percben (±3 perc)

type DayKind = "weekday" | "saturday" | "sunday";

const DAY_WINDOWS: Record<DayKind, { startMin: [number, number]; endMin: [number, number]; gapMin: [number, number]; typicalCap: number }> = {
  // [alsó, felső] percben éjfél óta
  weekday: { startMin: [7 * 60, 9 * 60], endMin: [21 * 60, 22 * 60 + 30], gapMin: [40, 90], typicalCap: 4 },
  saturday: { startMin: [9 * 60, 11 * 60], endMin: [22 * 60 + 30, 23 * 60 + 40], gapMin: [70, 160], typicalCap: 3 },
  sunday: { startMin: [13 * 60, 14 * 60 + 30], endMin: [19 * 60 + 15, 20 * 60 + 30], gapMin: [90, 200], typicalCap: 2 },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function pick([a, b]: [number, number], r: number) {
  return Math.round(a + (b - a) * r);
}

export type LocalParts = { y: number; m: number; d: number; wd: number; minuteOfDay: number };

export function localParts(date: Date, tz: string): LocalParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(date)) if (x.type !== "literal") p[x.type] = x.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, wd, minuteOfDay: +p.hour! * 60 + +p.minute! };
}

function dayKind(wd: number): DayKind {
  return wd === 6 ? "saturday" : wd === 0 ? "sunday" : "weekday";
}

/** Hét azonosító (helyi naptár szerint), hogy a sáv hetente újragenerálódjon. */
function weekKey(p: LocalParts) {
  const dayNum = Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  return Math.floor((dayNum + 3) / 7); // hétfő-alapú hét
}

/** Fiókonként, hetente és nap-típusonként eltérő ablak. */
export function windowFor(workflowId: string, p: LocalParts) {
  const kind = dayKind(p.wd);
  const w = DAY_WINDOWS[kind];
  const seed = `${workflowId}|${weekKey(p)}|${kind}`;
  return {
    kind,
    start: pick(w.startMin, hash(seed + "s")),
    end: pick(w.endMin, hash(seed + "e")),
    gap: pick(w.gapMin, hash(seed + "g")),
    typicalCap: w.typicalCap,
  };
}

export type Existing = { workflow_id: string; utc: Date };

/**
 * Igazítja a kért (már jitterezett) időpontot. Ugyanazon a helyi napon marad.
 * Visszaadja az új UTC időpontot és egy rövid magyarázatot a naplóhoz.
 */
export function adjustForBehavior(args: {
  workflowId: string;
  timezone: string;
  requested: Date;
  existing: Existing[];
}): { utc: Date; kind: DayKind; notes: string[] } {
  const { workflowId, timezone, requested, existing } = args;
  const notes: string[] = [];
  const p = localParts(requested, timezone);
  const win = windowFor(workflowId, p);
  const dayStartUtc = requested.getTime() - p.minuteOfDay * 60_000;
  const toUtc = (min: number) => new Date(dayStartUtc + min * 60_000 + Math.floor(Math.random() * 60) * 1000);

  const own = existing.filter((e) => e.workflow_id === workflowId);
  const others = existing.filter((e) => e.workflow_id !== workflowId);
  const sameDayOwn = own.filter((e) => {
    const q = localParts(e.utc, timezone);
    return q.y === p.y && q.m === p.m && q.d === p.d;
  });
  if (sameDayOwn.length >= win.typicalCap) notes.push(`napi szokásos darabszám (${win.typicalCap}) túllépve`);

  const past3w = own
    .map((e) => ({ e, q: localParts(e.utc, timezone) }))
    .filter(({ e, q }) => q.wd === p.wd && e.utc.getTime() < dayStartUtc && dayStartUtc - e.utc.getTime() < 22 * 86400000)
    .map(({ q }) => q.minuteOfDay);

  const ok = (min: number) => {
    if (min < win.start || min > win.end) return false;
    if (min % 5 === 0) return false; // kerek perc tilos
    const t = dayStartUtc + min * 60_000;
    if (sameDayOwn.some((e) => Math.abs(e.utc.getTime() - t) < win.gap * 60_000)) return false;
    if (past3w.some((m) => Math.abs(m - min) <= 30)) return false;
    if (others.some((e) => Math.abs(e.utc.getTime() - t) < 3 * 60_000)) return false;
    return true;
  };

  const want = p.minuteOfDay;
  if (ok(want)) return { utc: toUtc(want), kind: win.kind, notes };

  // Legközelebbi megfelelő perc keresése, véletlen irányelőnnyel.
  const clamped = Math.min(Math.max(want, win.start), win.end);
  if (clamped !== want) notes.push("helyi ablakon kívül esett");
  const dir = Math.random() < 0.5 ? 1 : -1;
  for (let d = 0; d <= 24 * 60; d++) {
    for (const s of [dir, -dir]) {
      const m = clamped + s * d;
      if (ok(m)) {
        notes.push(`eltolva ${m - want} perccel`);
        return { utc: toUtc(m), kind: win.kind, notes };
      }
    }
  }
  // Nincs szabad hely: csak a kerek percet és az ablakot biztosítjuk.
  let m = clamped;
  if (m % 5 === 0) m += 1 + Math.floor(Math.random() * 3);
  notes.push("nem volt teljesen szabad időpont; csak ablakba igazítva");
  return { utc: toUtc(m), kind: win.kind, notes };
}
