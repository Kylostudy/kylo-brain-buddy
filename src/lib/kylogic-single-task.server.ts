/**
 * Single-workflow task handler for the Kylogic → Brain cross-module channel.
 *
 * Covers task types that target ONE existing post/account (not a fan-out
 * across all localized workflows like publish_video does):
 *   - post_comment_reply   → reply to a specific comment on a specific post
 *   - metrics_snapshot     → read views/likes/comments count for a post
 *   - comments_snapshot    → list comments on a post (optionally since a ts)
 *
 * Match logic: (tenant_id, platform, region, active=true).
 * If multiple workflows match (e.g. several FB pages under HU/EN), the caller
 * SHOULD narrow it with `account_ref` in the payload — we honor that field by
 * matching against `workflows.name` (loose contains, case-insensitive) as a
 * best-effort until a dedicated account_ref column is introduced.
 *
 * Server-only. Uses supabaseAdmin — import inside handlers only.
 */

export type SingleTaskType =
  | "post_comment_reply"
  | "metrics_snapshot"
  | "comments_snapshot";

export type SingleTaskPayload = {
  platform: string;
  region?: string;
  account_ref?: string;
  post_url: string;
  // post_comment_reply-only fields:
  our_post_id?: string;
  parent_comment_id?: string;
  reply_text?: string;
  reply_draft_id?: string;
  scheduled_at?: string; // ISO UTC; if absent → ASAP
  // metrics_snapshot / comments_snapshot fields:
  since_comment_id?: string;
  since_ts?: string;
  [k: string]: unknown;
};

export type SingleTaskResult =
  | {
      ok: true;
      kylogic_task_id: string;
      workflow_id: string;
      platform: string;
      region: string | null;
      scheduled_utc: string;
      jitter_applied_seconds: number;
    }
  | { ok: false; status: number; error: string };

// ---------- Jitter (reused pattern) ---------------------------------------

const MAX_JITTER_SEC = 7 * 60;
const JITTER_MEAN_SEC = 120;

function poissonJitterSeconds(): number {
  const u = Math.max(1e-9, Math.random());
  const mag = Math.min(-Math.log(u) * JITTER_MEAN_SEC, MAX_JITTER_SEC);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return Math.round(sign * mag);
}

// ---------- Validation -----------------------------------------------------

export function validateSingleTaskPayload(
  taskType: SingleTaskType,
  raw: unknown,
): { ok: true; payload: SingleTaskPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `${taskType} payload must be an object` };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.platform !== "string" || !p.platform.trim()) {
    return { ok: false, error: "platform required" };
  }
  if (typeof p.post_url !== "string" || !p.post_url.trim()) {
    return { ok: false, error: "post_url required" };
  }
  if (p.region !== undefined && typeof p.region !== "string") {
    return { ok: false, error: "region must be a string" };
  }
  if (p.account_ref !== undefined && typeof p.account_ref !== "string") {
    return { ok: false, error: "account_ref must be a string" };
  }

  if (taskType === "post_comment_reply") {
    if (typeof p.parent_comment_id !== "string" || !p.parent_comment_id.trim()) {
      return { ok: false, error: "parent_comment_id required" };
    }
    if (typeof p.reply_text !== "string" || !p.reply_text.trim()) {
      return { ok: false, error: "reply_text required" };
    }
    if (typeof p.reply_draft_id !== "string" || !p.reply_draft_id.trim()) {
      return { ok: false, error: "reply_draft_id required" };
    }
  }

  return { ok: true, payload: p as SingleTaskPayload };
}

// ---------- Handler --------------------------------------------------------

export async function handleSingleTask(args: {
  taskType: SingleTaskType;
  kylogicTaskId: string;
  tenantId: string;
  kylogicCallbackUrl: string;
  payload: SingleTaskPayload;
}): Promise<SingleTaskResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Find matching workflow(s) — narrow scope, no language filter needed
  //    (the target post already exists on the account).
  let q = supabaseAdmin
    .from("workflows")
    .select("id, name, platform, region, timezone, active")
    .eq("module", "brain")
    .eq("tenant_id", args.tenantId)
    .eq("active", true)
    .eq("platform", args.payload.platform);

  if (args.payload.region) q = q.eq("region", args.payload.region);

  const { data: workflows, error: wfErr } = await q;
  if (wfErr) {
    console.error(`[${args.taskType}] workflow lookup failed`, wfErr);
    return { ok: false, status: 500, error: "workflow lookup failed" };
  }

  let candidates = workflows ?? [];

  // Optional account_ref disambiguation (loose match on workflow name).
  if (args.payload.account_ref && candidates.length > 1) {
    const needle = args.payload.account_ref.toLowerCase();
    const narrowed = candidates.filter((w) =>
      typeof w.name === "string" && w.name.toLowerCase().includes(needle),
    );
    if (narrowed.length > 0) candidates = narrowed;
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 404,
      error: `no active workflow matches platform=${args.payload.platform}${
        args.payload.region ? ` region=${args.payload.region}` : ""
      }`,
    };
  }
  if (candidates.length > 1) {
    console.warn(
      `[${args.taskType}] multiple workflows matched, picking first`,
      { count: candidates.length, kylogic_task_id: args.kylogicTaskId },
    );
  }
  const wf = candidates[0];

  // 2) Compute schedule time.
  const now = Date.now();
  let baseMs: number;
  if (args.payload.scheduled_at) {
    const parsed = Date.parse(args.payload.scheduled_at);
    if (!Number.isFinite(parsed)) {
      return { ok: false, status: 400, error: "invalid scheduled_at" };
    }
    baseMs = parsed;
  } else {
    baseMs = now;
  }

  // Reply gets human-feel jitter. Snapshots run ASAP with no jitter.
  const jitter =
    args.taskType === "post_comment_reply" ? poissonJitterSeconds() : 0;
  const scheduledUtc = new Date(baseMs + jitter * 1000).toISOString();

  // 3) Upsert into brain_task_queue.
  const row = {
    kylogic_task_id: args.kylogicTaskId,
    tenant_id: args.tenantId,
    workflow_id: wf.id as string,
    task_type: args.taskType,
    platform: (wf.platform as string) ?? null,
    language: null,
    region: (wf.region as string) ?? null,
    payload: args.payload as unknown as Record<string, unknown>,
    scheduled_local: null,
    scheduled_utc: scheduledUtc,
    jitter_applied_seconds: jitter,
    kylogic_callback_url: args.kylogicCallbackUrl,
    status: "queued",
  };

  const { error: insErr } = await supabaseAdmin
    .from("brain_task_queue")
    .upsert(row as never, {
      onConflict: "kylogic_task_id,workflow_id",
      ignoreDuplicates: true,
    });

  if (insErr) {
    console.error(`[${args.taskType}] queue insert failed`, insErr);
    return { ok: false, status: 500, error: "queue insert failed" };
  }

  return {
    ok: true,
    kylogic_task_id: args.kylogicTaskId,
    workflow_id: wf.id as string,
    platform: (wf.platform as string) ?? args.payload.platform,
    region: (wf.region as string) ?? null,
    scheduled_utc: scheduledUtc,
    jitter_applied_seconds: jitter,
  };
}
