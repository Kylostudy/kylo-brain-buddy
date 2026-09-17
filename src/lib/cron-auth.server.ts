/**
 * Szerver-oldali közös titok az ütemezett (pg_cron) végpontokhoz.
 *
 * Korábban ezek a végpontok a publikus (böngészőbe is kikerülő) Supabase
 * publishable kulcsot ellenőrizték — az bárki számára elérhető, tehát nem
 * volt valódi védelem. Mostantól egy csak szerverről olvasható titkot
 * hasonlítunk össze, amit a public.cron_auth táblában tárolunk (RLS zárva,
 * csak a service_role látja), így a pg_cron hívások és az alkalmazás
 * ugyanazt az értéket használják.
 */
import { timingSafeEqual } from "node:crypto";

let cached: { secret: string; at: number } | null = null;
const TTL_MS = 60_000;

async function loadSecret(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.secret;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("cron_auth" as never)
    .select("secret")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  const secret = (data as { secret?: string }).secret?.trim() ?? "";
  if (!secret) return null;
  cached = { secret, at: Date.now() };
  return secret;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** true, ha a kérés a megfelelő cron-titkot hozza. */
export async function verifyCronRequest(request: Request): Promise<boolean> {
  const expected = await loadSecret();
  if (!expected) return false;

  const candidates: string[] = [];
  const header = request.headers.get("x-cron-secret")?.trim();
  if (header) candidates.push(header);
  const auth = request.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) candidates.push(auth.slice(7).trim());
  const workerToken = process.env.WORKER_API_TOKEN?.trim();

  for (const c of candidates) {
    if (safeEqual(c, expected)) return true;
    if (workerToken && safeEqual(c, workerToken)) return true;
  }
  return false;
}
