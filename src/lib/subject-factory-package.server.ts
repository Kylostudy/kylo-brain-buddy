import { createHash } from "node:crypto";
import { validatePackage, KYLOGIC_TENANT } from "../../worker/executor/scripts/brain-tasks/subject-factory-contract.js";

export async function receiveFactoryTask(request: Request, body: { task_id: string; tenant_id: string; kylogic_callback_url: string; payload?: unknown }) {
  const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
  // Shared HMAC authenticates the peer; a fixed operation-specific tenant grant
  // supplies the second authorization check. Tenant identity alone never grants access.
  if (body.tenant_id !== KYLOGIC_TENANT || request.headers.get("x-tenant-id") !== KYLOGIC_TENANT) return fail(403, "tenant_not_authorized");
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(body.task_id) || request.headers.get("idempotency-key") !== body.task_id) return fail(400, "idempotency_key_required");
  let payload;
  try { payload = validatePackage(body.payload); } catch (e) { return fail(400, e instanceof Error ? e.message : "invalid_package"); }
  let callback;
  try { callback = new URL(body.kylogic_callback_url); } catch { return fail(400, "invalid_callback"); }
  if (callback.origin !== "https://kylogic.lovable.app" || callback.username || callback.password || !callback.pathname.startsWith("/api/public/")) return fail(400, "callback_not_allowed");
  const identity = createHash("sha256").update(JSON.stringify({ package_id: payload.package_id, manifest_sha256: payload.manifest_sha256, files: payload.files.map(({ url, ...f }) => f).sort((a, b) => a.name.localeCompare(b.name)) })).digest("hex");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: existing, error: lookupError } = await db.from("kylogic_incoming_tasks").select("tenant_id, task_type, result").eq("task_id", body.task_id).maybeSingle();
  if (lookupError) return fail(500, "task_lookup_failed");
  if (existing && (existing.tenant_id !== KYLOGIC_TENANT || existing.task_type !== "receive_subject_factory_package" || (existing.result as Record<string, unknown> | null)?.identity_sha256 !== identity)) return fail(409, "idempotency_conflict");
  // One fixed system workflow per package operation, no social credentials/proxy.
  const { data: workflow, error: wfError } = await db.from("workflows").select("id").eq("tenant_id", KYLOGIC_TENANT).eq("platform", "system").eq("name", "Subject factory package receiver").maybeSingle();
  if (wfError || !workflow) return fail(503, "receiver_workflow_unavailable");
  if (!existing) {
    const { error } = await db.from("kylogic_incoming_tasks").insert({ task_id: body.task_id, tenant_id: KYLOGIC_TENANT, task_type: "receive_subject_factory_package", kylogic_callback_url: callback.href, payload: { package_id: payload.package_id, manifest_sha256: payload.manifest_sha256 } as never, status: "pending", result: { identity_sha256: identity } as never });
    if (error) return fail(error.code === "23505" ? 409 : 500, "task_persist_failed");
  }
  const { error: queueError } = await db.from("brain_task_queue").upsert({ kylogic_task_id: body.task_id, tenant_id: KYLOGIC_TENANT, workflow_id: workflow.id, task_type: "receive_subject_factory_package", platform: "system", payload: payload as never, scheduled_utc: new Date().toISOString(), jitter_applied_seconds: 0, kylogic_callback_url: callback.href, status: "queued" } as never, { onConflict: "kylogic_task_id,workflow_id", ignoreDuplicates: true });
  if (queueError) return fail(500, "queue_insert_failed");
  const { data: task, error: taskError } = await db.from("brain_task_queue").select("status").eq("kylogic_task_id", body.task_id).eq("tenant_id", KYLOGIC_TENANT).maybeSingle();
  if (taskError || !task) return fail(500, "queue_read_failed");
  await db.from("kylogic_incoming_task_log").insert({ task_id: body.task_id, event: existing ? "package.replayed" : "package.queued", outcome: "info", detail: { package_id: payload.package_id, manifest_sha256: payload.manifest_sha256, identity_sha256: identity } });
  return Response.json({ ok: true, task_id: body.task_id, version: 1, package_id: payload.package_id, manifest_sha256: payload.manifest_sha256, status: task.status, idempotent_replay: Boolean(existing), installation_status: "not_installed" }, { status: existing ? 200 : 202 });
}