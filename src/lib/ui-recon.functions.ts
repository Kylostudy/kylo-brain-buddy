// Felderítő járat (UI recon) — felület felé szolgáló szerverfüggvények.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReconSnapshotRow = {
  id: string;
  platform: string;
  page_type: string;
  url: string;
  changed: boolean;
  change_note: string | null;
  learned_fields: string[];
  analysis: { layout_summary?: string; proposals?: unknown[]; error?: string | null } | null;
  created_at: string;
  image_url: string | null;
};

export const listReconSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReconSnapshotRow[]> => {
    const { data, error } = await context.supabase
      .from("ui_recon_snapshots")
      .select(
        "id, platform, page_type, url, changed, change_note, learned_fields, analysis, screenshot_path, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const out: ReconSnapshotRow[] = [];
    for (const r of rows) {
      let imageUrl: string | null = null;
      if (r.screenshot_path) {
        const { data: signed } = await context.supabase.storage
          .from("ui-recon-shots")
          .createSignedUrl(r.screenshot_path as string, 60 * 60);
        imageUrl = signed?.signedUrl ?? null;
      }
      out.push({
        id: r.id as string,
        platform: r.platform as string,
        page_type: r.page_type as string,
        url: (r.url as string) ?? "",
        changed: !!r.changed,
        change_note: (r.change_note as string | null) ?? null,
        learned_fields: (r.learned_fields as string[]) ?? [],
        analysis: (r.analysis as ReconSnapshotRow["analysis"]) ?? null,
        created_at: r.created_at as string,
        image_url: imageUrl,
      });
    }
    return out;
  });

export const listLearnedSelectors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    // A tanult szelektorok globálisak; olvasáshoz elég a bejelentkezés,
    // de a service role kliens adja vissza őket.
    void data;
    void error;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error: err2 } = await supabaseAdmin
      .from("worker_learned_selectors")
      .select(
        "id, platform, page_type, field, selector, learned_from, success_count, fail_count, last_verified_at, last_failed_at, updated_at",
      )
      .order("platform", { ascending: true })
      .order("page_type", { ascending: true })
      .order("field", { ascending: true });
    if (err2) throw new Error(err2.message);
    return rows ?? [];
  });

/** Felderítő járat sorba állítása egy LinkedIn workflow-hoz. */
export const queueReconRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workflow_id: string; platform?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: wf, error: wfErr } = await context.supabase
      .from("workflows")
      .select("id, tenant_id")
      .eq("id", data.workflow_id)
      .maybeSingle();
    if (wfErr) throw new Error(wfErr.message);
    if (!wf) throw new Error("Nem található a workflow.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const taskId = `ui-recon-${Date.now()}`;
    const { error } = await supabaseAdmin.from("brain_task_queue").insert({
      kylogic_task_id: taskId,
      tenant_id: wf.tenant_id as string,
      workflow_id: wf.id as string,
      task_type: "ui_recon",
      platform: data.platform ?? "linkedin",
      payload: { task_type: "ui_recon", platform: data.platform ?? "linkedin" },
      scheduled_utc: new Date().toISOString(),
      status: "queued",
      kylogic_callback_url: "",
    });
    if (error) throw new Error(error.message);
    return { ok: true, task_id: taskId };
  });
