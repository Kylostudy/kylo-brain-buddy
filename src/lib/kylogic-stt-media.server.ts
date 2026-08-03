/**
 * stt_media_fetch — Kylo.study STT kalibrációs labor médialetöltő taszkja.
 *
 * Nem social-platform taszk: nincs account, nincs cookie, nincs proxy.
 * Egy dedikált "rendszer" workflow-hoz kötjük (platform = "system",
 * name = "STT media fetch"), hogy a meglévő
 * brain_task_queue → dispatch-brain-tasks → worker/claim → worker/complete
 * úton fusson végig, változatlan szerződéssel.
 *
 * Server-only.
 */

export type SttMediaPayload = {
  source_id: string;
  language: string;
  page_url?: string | null;
  audio_url?: string | null;
  transcript_url?: string | null;
  want: Array<"audio" | "transcript">;
  /** Opcionális aláírt feltöltő URL-ek (PUT). Ha nincs, a worker
   *  időlimites letöltő URL-t ad vissza a saját tárolójából. */
  audio_upload_url?: string | null;
  transcript_upload_url?: string | null;
  max_bytes?: number;
  [k: string]: unknown;
};

export type SttMediaResult =
  | {
      ok: true;
      workflow_id: string;
      scheduled_utc: string;
    }
  | { ok: false; status: number; error: string };

const SYSTEM_WORKFLOW_NAME = "STT media fetch";

export function validateSttMediaPayload(
  raw: unknown,
): { ok: true; payload: SttMediaPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "stt_media_fetch payload must be an object" };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.source_id !== "string" || !p.source_id.trim()) {
    return { ok: false, error: "source_id required" };
  }
  if (typeof p.language !== "string" || !p.language.trim()) {
    return { ok: false, error: "language required" };
  }
  const want = Array.isArray(p.want)
    ? p.want.filter((w): w is "audio" | "transcript" => w === "audio" || w === "transcript")
    : [];
  if (want.length === 0) {
    return { ok: false, error: 'want must contain "audio" and/or "transcript"' };
  }
  const urls = ["page_url", "audio_url", "transcript_url", "audio_upload_url", "transcript_upload_url"];
  for (const key of urls) {
    const v = p[key];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return { ok: false, error: `${key} must be a string or null` };
    }
  }
  if (!p.page_url && !p.audio_url && !p.transcript_url) {
    return { ok: false, error: "page_url, audio_url or transcript_url required" };
  }

  return {
    ok: true,
    payload: {
      ...(p as Record<string, unknown>),
      source_id: p.source_id,
      language: p.language,
      want,
    } as SttMediaPayload,
  };
}

/** Megkeresi vagy létrehozza a tenant "STT media fetch" rendszer-workflow-ját. */
async function ensureSystemWorkflow(tenantId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("workflows")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("module", "brain")
    .eq("platform", "system")
    .eq("name", SYSTEM_WORKFLOW_NAME)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabaseAdmin
    .from("workflows")
    .insert({
      tenant_id: tenantId,
      module: "brain",
      name: SYSTEM_WORKFLOW_NAME,
      platform: "system",
      active: true,
      spec: {
        monitor_type: "stt_media_fetch",
        no_proxy: true,
        no_cookie_reuse: true,
      } as never,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[stt_media_fetch] system workflow create failed", error);
    return null;
  }
  return created.id as string;
}

export async function handleSttMediaFetch(args: {
  kylogicTaskId: string;
  tenantId: string;
  kylogicCallbackUrl: string;
  payload: SttMediaPayload;
}): Promise<SttMediaResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const workflowId = await ensureSystemWorkflow(args.tenantId);
  if (!workflowId) {
    return { ok: false, status: 500, error: "system workflow unavailable" };
  }

  // Gépi taszk: nincs emberi jitter, ASAP fut.
  const scheduledUtc = new Date().toISOString();

  const { error: insErr } = await supabaseAdmin.from("brain_task_queue").upsert(
    {
      kylogic_task_id: args.kylogicTaskId,
      tenant_id: args.tenantId,
      workflow_id: workflowId,
      task_type: "stt_media_fetch",
      platform: "system",
      language: args.payload.language,
      region: null,
      payload: args.payload as unknown as Record<string, unknown>,
      scheduled_local: null,
      scheduled_utc: scheduledUtc,
      jitter_applied_seconds: 0,
      kylogic_callback_url: args.kylogicCallbackUrl,
      status: "queued",
    } as never,
    { onConflict: "kylogic_task_id,workflow_id", ignoreDuplicates: true },
  );

  if (insErr) {
    console.error("[stt_media_fetch] queue insert failed", insErr);
    return { ok: false, status: 500, error: "queue insert failed" };
  }

  return { ok: true, workflow_id: workflowId, scheduled_utc: scheduledUtc };
}
