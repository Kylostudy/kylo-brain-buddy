/**
 * publish_video task handler for the Kylogic → Brain cross-module channel.
 *
 * Filtered mode: Kylogic sends ONE task per video with (language, region,
 * platforms?). Brain fans it out into N brain_task_queue rows, one per
 * matched workflow. Each row gets its own scheduled_utc = local wall-clock
 * time (in the workflow's timezone) plus ±7 min Poisson jitter.
 *
 * Server-only. Uses supabaseAdmin, so import only from server routes/fns.
 */

export type PublishVideoPayload = {
  video_uid: string;
  language: string;
  region?: string;
  platforms?: string[];
  scheduled_local: string; // "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
  video_url?: string;
  caption?: string;
  hashtags?: string[];
  [k: string]: unknown;
};

export type FanOutRow = {
  workflow_id: string;
  platform: string | null;
  language: string | null;
  region: string | null;
  timezone: string | null;
  scheduled_local: string;
  scheduled_utc: string;
  jitter_applied_seconds: number;
};

const MAX_JITTER_SEC = 7 * 60; // ±7 min per v3 agreement
const JITTER_MEAN_SEC = 120; // exponential mean, then clamped

// ---------- Time helpers --------------------------------------------------

/**
 * Convert a naive local wall-clock ISO ("YYYY-MM-DDTHH:MM[:SS]") in the
 * given IANA timezone to an absolute UTC Date. Works on Cloudflare workerd
 * via Intl.DateTimeFormat.
 */
export function zonedLocalToUtc(localISO: string, timezone: string): Date {
  const m = localISO.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) throw new Error(`Invalid scheduled_local: ${localISO}`);
  const [, Y, M, D, h, mm, s] = m;
  const Yn = Number(Y),
    Mn = Number(M),
    Dn = Number(D),
    hn = Number(h),
    mn = Number(mm),
    sn = s ? Number(s) : 0;

  // Guess: treat wall clock as if it were UTC.
  const guessMs = Date.UTC(Yn, Mn - 1, Dn, hn, mn, sn);

  // What wall clock does that instant show in the target zone?
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(guessMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const shownMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  const offset = shownMs - guessMs;
  return new Date(guessMs - offset);
}

/**
 * Exponential-magnitude, random-sign jitter clamped to ±MAX_JITTER_SEC.
 * Produces a distribution biased toward small offsets — matches the human
 * behavior profile (Poisson-like small delays, rare larger ones).
 */
export function poissonJitterSeconds(
  maxSec = MAX_JITTER_SEC,
  meanSec = JITTER_MEAN_SEC,
): number {
  const u = Math.max(1e-9, Math.random());
  const mag = Math.min(-Math.log(u) * meanSec, maxSec);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return Math.round(sign * mag);
}

// ---------- Payload validation --------------------------------------------

export function validatePublishVideoPayload(
  raw: unknown,
): { ok: true; payload: PublishVideoPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "publish_video payload must be an object" };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.video_uid !== "string" || !p.video_uid.trim()) {
    return { ok: false, error: "video_uid required" };
  }
  if (typeof p.language !== "string" || !p.language.trim()) {
    return { ok: false, error: "language required" };
  }
  if (typeof p.scheduled_local !== "string" || !p.scheduled_local.trim()) {
    return { ok: false, error: "scheduled_local required" };
  }
  if (
    p.platforms !== undefined &&
    !(Array.isArray(p.platforms) && p.platforms.every((x) => typeof x === "string"))
  ) {
    return { ok: false, error: "platforms must be an array of strings" };
  }
  if (p.region !== undefined && typeof p.region !== "string") {
    return { ok: false, error: "region must be a string" };
  }

  return { ok: true, payload: p as PublishVideoPayload };
}

// ---------- Main handler ---------------------------------------------------

export type PublishVideoResult =
  | {
      ok: true;
      kylogic_task_id: string;
      fanout: FanOutRow[];
      matched_workflows: number;
    }
  | { ok: false; status: number; error: string };

type SupabaseAdmin = Awaited<
  ReturnType<typeof loadAdmin>
>["supabaseAdmin"];

async function loadAdmin() {
  return await import("@/integrations/supabase/client.server");
}

/**
 * Fans a Kylogic publish_video task out into N brain_task_queue rows.
 * Idempotent: unique(kylogic_task_id, workflow_id) means replays merely
 * return the existing rows.
 */
export async function handlePublishVideo(args: {
  kylogicTaskId: string;
  tenantId: string;
  kylogicCallbackUrl: string;
  payload: PublishVideoPayload;
}): Promise<PublishVideoResult> {
  const { supabaseAdmin } = await loadAdmin();

  // 1) Select matching workflows.
  let q = supabaseAdmin
    .from("workflows")
    .select("id, platform, language, region, timezone, active, daily_cap")
    .eq("module", "brain")
    .eq("tenant_id", args.tenantId)
    .eq("active", true)
    .eq("language", args.payload.language);

  if (args.payload.region) q = q.eq("region", args.payload.region);
  if (args.payload.platforms && args.payload.platforms.length > 0) {
    q = q.in("platform", args.payload.platforms);
  }

  const { data: workflows, error: wfErr } = await q;
  if (wfErr) {
    console.error("[publish_video] workflow lookup failed", wfErr);
    return { ok: false, status: 500, error: "workflow lookup failed" };
  }

  const matched = (workflows ?? []).filter(
    (w) => w.platform && w.timezone,
  );

  if (matched.length === 0) {
    return {
      ok: true,
      kylogic_task_id: args.kylogicTaskId,
      matched_workflows: 0,
      fanout: [],
    };
  }

  // 2) Build fan-out rows with per-workflow jitter.
  const fanout: FanOutRow[] = [];
  const rowsToInsert: Array<Record<string, unknown>> = [];

  for (const wf of matched) {
    let scheduledUtc: Date;
    try {
      const baseUtc = zonedLocalToUtc(
        args.payload.scheduled_local,
        wf.timezone as string,
      );
      const jitter = poissonJitterSeconds();
      scheduledUtc = new Date(baseUtc.getTime() + jitter * 1000);

      const row: FanOutRow = {
        workflow_id: wf.id as string,
        platform: (wf.platform as string) ?? null,
        language: (wf.language as string) ?? null,
        region: (wf.region as string) ?? null,
        timezone: (wf.timezone as string) ?? null,
        scheduled_local: args.payload.scheduled_local,
        scheduled_utc: scheduledUtc.toISOString(),
        jitter_applied_seconds: jitter,
      };
      fanout.push(row);

      rowsToInsert.push({
        kylogic_task_id: args.kylogicTaskId,
        tenant_id: args.tenantId,
        workflow_id: row.workflow_id,
        task_type: "publish_video",
        platform: row.platform,
        language: row.language,
        region: row.region,
        payload: args.payload as unknown as Record<string, unknown>,
        scheduled_local: args.payload.scheduled_local,
        scheduled_utc: row.scheduled_utc,
        jitter_applied_seconds: row.jitter_applied_seconds,
        kylogic_callback_url: args.kylogicCallbackUrl,
        status: "queued",
      });
    } catch (err) {
      console.error("[publish_video] tz convert failed", {
        wf: wf.id,
        tz: wf.timezone,
        err,
      });
      // Skip this workflow — we can still fan out the others.
    }
  }

  if (rowsToInsert.length === 0) {
    return { ok: false, status: 400, error: "no workflows could be scheduled" };
  }

  // 3) Upsert on (kylogic_task_id, workflow_id) for idempotency.
  const { error: insErr } = await (supabaseAdmin as SupabaseAdmin)
    .from("brain_task_queue")
    .upsert(rowsToInsert as never, {
      onConflict: "kylogic_task_id,workflow_id",
      ignoreDuplicates: true,
    });

  if (insErr) {
    console.error("[publish_video] queue insert failed", insErr);
    return { ok: false, status: 500, error: "queue insert failed" };
  }

  return {
    ok: true,
    kylogic_task_id: args.kylogicTaskId,
    matched_workflows: matched.length,
    fanout,
  };
}
