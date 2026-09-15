/**
 * archive_video — Kylogicban elkészült videók végleges archiválása a Brain VPS
 * lemezére.
 *
 * Nem social-platform taszk: nincs account, nincs cookie, nincs proxy, nincs
 * emberi jitter. Egy dedikált "rendszer" workflow-hoz kötjük (platform =
 * "system", name = "Video archive"), hogy a megszokott
 * brain_task_queue → dispatch-brain-tasks → worker/claim → worker/complete
 * úton fusson végig, változatlan szerződéssel.
 *
 * Server-only.
 */

export type ArchiveVideoPayload = {
  source_url: string;
  target_path: string;
  kind?: string | null;
  ref_id: string;
  [k: string]: unknown;
};

export type ArchiveVideoResult =
  | { ok: true; workflow_id: string; scheduled_utc: string }
  | { ok: false; status: number; error: string };

const SYSTEM_WORKFLOW_NAME = "Video archive";

/** Csak relatív, kilépés nélküli útvonalat engedünk a lemezre. */
export function normalizeArchivePath(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\/+/, "");
  if (!cleaned) return null;
  const parts = cleaned.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === "." || p === ".." || p.includes("\0"))) return null;
  if (parts.length === 0) return null;
  return parts.join("/");
}

export function validateArchiveVideoPayload(
  raw: unknown,
): { ok: true; payload: ArchiveVideoPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "archive_video payload must be an object" };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.source_url !== "string" || !/^https?:\/\//i.test(p.source_url)) {
    return { ok: false, error: "source_url must be an http(s) URL" };
  }
  if (typeof p.target_path !== "string" || !p.target_path.trim()) {
    return { ok: false, error: "target_path required" };
  }
  const target = normalizeArchivePath(p.target_path);
  if (!target) {
    return { ok: false, error: "target_path is not a safe relative path" };
  }
  if (typeof p.ref_id !== "string" || !p.ref_id.trim()) {
    return { ok: false, error: "ref_id required" };
  }
  if (p.kind !== undefined && p.kind !== null && typeof p.kind !== "string") {
    return { ok: false, error: "kind must be a string or null" };
  }

  return {
    ok: true,
    payload: {
      ...(p as Record<string, unknown>),
      source_url: p.source_url,
      target_path: target,
      ref_id: p.ref_id,
      kind: (p.kind as string | undefined) ?? "poster_video",
    } as ArchiveVideoPayload,
  };
}

/** Megkeresi vagy létrehozza a tenant "Video archive" rendszer-workflow-ját. */
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
        monitor_type: "archive_video",
        no_proxy: true,
        no_cookie_reuse: true,
      } as never,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[archive_video] system workflow create failed", error);
    return null;
  }
  return created.id as string;
}

export async function handleArchiveVideo(args: {
  kylogicTaskId: string;
  tenantId: string;
  kylogicCallbackUrl: string;
  payload: ArchiveVideoPayload;
}): Promise<ArchiveVideoResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const workflowId = await ensureSystemWorkflow(args.tenantId);
  if (!workflowId) {
    return { ok: false, status: 500, error: "system workflow unavailable" };
  }

  // Gépi taszk: ASAP fut, nincs emberi késleltetés.
  const scheduledUtc = new Date().toISOString();

  const { error: insErr } = await supabaseAdmin.from("brain_task_queue").upsert(
    {
      kylogic_task_id: args.kylogicTaskId,
      tenant_id: args.tenantId,
      workflow_id: workflowId,
      task_type: "archive_video",
      platform: "system",
      language: null,
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
    console.error("[archive_video] queue insert failed", insErr);
    return { ok: false, status: 500, error: "queue insert failed" };
  }

  return { ok: true, workflow_id: workflowId, scheduled_utc: scheduledUtc };
}
