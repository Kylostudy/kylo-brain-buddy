// Időzítés-szórás: ne kerüljön poszt pontosan ugyanarra az óra:percre, mint
// bármelyik korábbi (elmúlt 30 nap) vagy már beütemezett posztunk.
// A kért időponthoz ±30 perc véletlen eltolást adunk, budapesti idő szerint
// ellenőrizve az óra:perc ütközést.

const TZ = "Europe/Budapest";

function hhmm(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

type Sb = { from: (t: string) => any };

/**
 * @param sb supabase kliens
 * @param requested a felhasználó által megadott időpont
 * @param spreadMinutes maximális eltolás percben (alap: 30)
 */
export async function jitterSchedule(
  sb: Sb,
  requested: Date,
  spreadMinutes = 30,
): Promise<{ when: Date; shifted_minutes: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: past }, { data: future }] = await Promise.all([
    sb
      .from("content_drafts")
      .select("submitted_at")
      .not("submitted_at", "is", null)
      .gte("submitted_at", since),
    sb.from("content_drafts").select("scheduled_for").not("scheduled_for", "is", null),
  ]);

  const used = new Set<string>();
  for (const r of past ?? []) if (r.submitted_at) used.add(hhmm(r.submitted_at as string));
  for (const r of future ?? []) if (r.scheduled_for) used.add(hhmm(r.scheduled_for as string));

  // Jelöltek: véletlen sorrendben az összes ±spread percnyi eltolás.
  const offsets: number[] = [];
  for (let m = -spreadMinutes; m <= spreadMinutes; m++) offsets.push(m);
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j]!, offsets[i]!];
  }

  for (const off of offsets) {
    const cand = new Date(requested.getTime() + off * 60_000);
    if (cand.getTime() < Date.now()) continue;
    if (used.has(hhmm(cand))) continue;
    return { when: cand, shifted_minutes: off };
  }

  // Ha minden perc foglalt lenne, egy véletlen eltolás akkor is jobb a fixnél.
  const off = Math.floor(Math.random() * (2 * spreadMinutes + 1)) - spreadMinutes;
  return { when: new Date(requested.getTime() + off * 60_000), shifted_minutes: off };
}
