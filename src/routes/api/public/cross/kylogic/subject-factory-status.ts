import { createFileRoute } from "@tanstack/react-router";
import { verifyKylogicTaskRequest } from "@/lib/kylogic-bridge.server";
import { KYLOGIC_TENANT } from "../../../../../../worker/executor/scripts/brain-tasks/subject-factory-contract.js";

export const Route = createFileRoute("/api/public/cross/kylogic/subject-factory-status")({
  server: { handlers: { GET: async ({ request }) => {
    const url = new URL(request.url);
    const auth = verifyKylogicTaskRequest("GET", url.pathname + url.search, "", request.headers);
    if (!auth.ok) return Response.json({ ok: false, error: auth.reason }, { status: auth.status });
    if (request.headers.get("x-tenant-id") !== KYLOGIC_TENANT) return Response.json({ ok: false, error: "tenant_not_authorized" }, { status: 403 });
    const taskId = url.searchParams.get("task_id");
    if (!taskId || !/^[a-zA-Z0-9_-]{1,120}$/.test(taskId)) return Response.json({ ok: false, error: "invalid_task_id" }, { status: 400 });
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data, error } = await db.from("brain_task_queue").select("status,result,error,completed_at").eq("tenant_id", KYLOGIC_TENANT).eq("kylogic_task_id", taskId).eq("task_type", "receive_subject_factory_package").maybeSingle();
    if (error) return Response.json({ ok: false, error: "status_unavailable" }, { status: 500 });
    if (!data) return Response.json({ ok: false, error: "task_not_found" }, { status: 404 });
    // Whitelist output, including errors: never reflect signed download URLs.
    const r = data.result as Record<string, unknown> | null;
    const files = Array.isArray(r?.files) ? r.files.map((f: Record<string, unknown>) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 })) : [];
    return Response.json({ ok: true, task_id: taskId, status: data.status, completed_at: data.completed_at, receipt_status: r?.receipt_status ?? "not_verified", installation_status: r?.installation_status ?? "not_installed", manifest_sha256: r?.manifest_sha256 ?? null, files, error: data.error ? "package_receipt_failed" : null }, { headers: { "Cache-Control": "no-store" } });
  } } },
});