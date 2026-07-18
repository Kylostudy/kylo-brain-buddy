// Audit QA szerver-fn-ek — a UI hívja őket. Minden fn a signed-in user Supabase
// klienssel dolgozik (RLS a tenanton keresztül).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPatchPackage, type PatchIssue } from "@/lib/audit-qa/patch-package";

const StartRunInput = z.object({
  baseUrl: z.string().url().default("https://kylo.study"),
  languages: z.array(z.string().min(2)).min(1),
  skins: z.array(z.string().min(1)).default(["default"]),
  costCapUsd: z.number().positive().max(500).default(50),
  credentialId: z.string().uuid().nullable().optional(),
  workflowId: z.string().uuid().nullable().optional(),
  maxPagesPerCombo: z.number().int().min(1).max(500).default(120),
  // Új: bejelentkezéshez a UI-ból kapott email/password (titkosítva mentjük a workflow_credentials-be).
  // Ha üres a password, a workflow-hoz korábban mentett jelszót használjuk.
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().max(500).optional().or(z.literal("")),
});

/** Új QA futás indítása. Létrehoz egy audit_qa_runs sort + egy queued brain_workflow_runs sort a workernek. */
export const startAuditQaRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartRunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Tenant meghatározás a profiles-ből
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (profErr || !prof?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
    const tenantId = prof.tenant_id;

    // 1) audit_qa_runs
    const { data: run, error: runErr } = await supabase
      .from("audit_qa_runs")
      .insert({
        tenant_id: tenantId,
        workflow_id: data.workflowId ?? null,
        status: "running",
        base_url: data.baseUrl,
        config: {
          languages: data.languages,
          skins: data.skins,
          maxPagesPerCombo: data.maxPagesPerCombo,
          credentialId: data.credentialId ?? null,
        },
        cost_cap_usd: data.costCapUsd,
      })
      .select("id, started_at, base_url")
      .single();
    if (runErr || !run) throw new Error(runErr?.message || "run insert failed");

    // 2) Workflow meghatározása. Ha nincs átadva, ÚJRAHASZNÁLJUK a tenant
    // legutóbbi kylo-study-qa workflow-ját — így nem hoz létre új workflow
    // sort minden futásnál. Csak akkor csinálunk újat, ha még egy sincs.
    let wfId = data.workflowId ?? null;
    if (!wfId) {
      const { data: existing } = await supabase
        .from("workflows")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("module", "audit")
        .contains("spec", { monitor_type: "kylo-study-qa" })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        wfId = existing.id;
      } else {
        const { data: wf, error: wfErr } = await supabase
          .from("workflows")
          .insert({
            tenant_id: tenantId,
            module: "audit",
            name: "Kylo.study QA — nyelv és skin tesztelés",
            spec: { monitor_type: "kylo-study-qa" } as never,
          })
          .select("id")
          .single();
        if (wfErr || !wf) throw new Error(wfErr?.message || "workflow insert failed");
        wfId = wf.id;
      }
      await supabase.from("audit_qa_runs").update({ workflow_id: wfId }).eq("id", run.id);
    }

    // 2b) Titkosított credentials mentése/frissítése a workflow_credentials-be.
    // Csak akkor írjuk felül a jelszót, ha a UI-ban tényleg megadtak egy újat.
    // Így legközelebb elég csak az emailt beírni (vagy azt sem, ha stimmel).
    const emailIn = (data.email ?? "").trim();
    const passwordIn = (data.password ?? "").trim();
    if (emailIn && passwordIn) {
      const { encryptString } = await import("@/lib/credentials/crypto.server");
      const pw = await encryptString(passwordIn);
      const { error: credErr } = await supabase
        .from("workflow_credentials")
        .upsert(
          {
            workflow_id: wfId,
            platform: "kylo-study",
            username: emailIn,
            password_ciphertext: pw.ciphertext,
            password_nonce: pw.nonce,
          } as never,
          { onConflict: "workflow_id" },
        );
      if (credErr) throw new Error(`credentials mentése sikertelen: ${credErr.message}`);
    } else if (emailIn && !passwordIn) {
      // Csak az emailt frissítjük, a mentett jelszót békén hagyjuk.
      const { error: credErr } = await supabase
        .from("workflow_credentials")
        .update({ username: emailIn } as never)
        .eq("workflow_id", wfId);
      if (credErr) throw new Error(`credentials frissítés sikertelen: ${credErr.message}`);
    }

    // 3) queued brain_workflow_runs (a worker ezt claimolja)
    const spec = {
      monitor_type: "kylo-study-qa",
      audit_qa: {
        run_id: run.id,
        base_url: data.baseUrl,
        languages: data.languages,
        skins: data.skins,
        max_pages_per_combo: data.maxPagesPerCombo,
        max_clicks_per_page: 14,
        cost_cap_usd: data.costCapUsd,
      },
    };
    const { error: qErr } = await supabase.from("brain_workflow_runs").insert({
      workflow_id: wfId,
      tenant_id: tenantId,
      module: "audit",
      runner: "docker",
      status: "queued",
      spec_snapshot: spec as never,
      started_at: new Date().toISOString(),
      logs: [
        {
          ts: new Date().toISOString(),
          level: "info",
          message: `Kylo.study QA futás sorba téve — run_id=${run.id}`,
        },
      ] as never,
    });
    if (qErr) throw new Error(qErr.message);

    return { runId: run.id, startedAt: run.started_at, baseUrl: run.base_url };
  });

/**
 * A QA dialóghoz: visszaadja a tenant kylo-study-qa workflow-jához mentett
 * email címet és hogy van-e mentett jelszó. Így nem kell minden futáskor
 * újra beírni. A jelszót SOHA nem küldjük vissza.
 */
export const getAuditQaCredentialHint = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) return { email: null as string | null, hasSavedPassword: false };

    const { data: wf } = await supabase
      .from("workflows")
      .select("id")
      .eq("tenant_id", prof.tenant_id)
      .eq("module", "audit")
      .contains("spec", { monitor_type: "kylo-study-qa" })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!wf?.id) return { email: null as string | null, hasSavedPassword: false };

    const { data: cred } = await supabase
      .from("workflow_credentials")
      .select("username, password_ciphertext")
      .eq("workflow_id", wf.id)
      .maybeSingle();
    return {
      email: (cred?.username as string | null) ?? null,
      hasSavedPassword: !!cred?.password_ciphertext,
    };
  });

export const listAuditQaRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_qa_runs")
      .select(
        "id, status, base_url, config, total_pages_visited, total_issues_found, total_cost_usd, cost_cap_usd, started_at, updated_at, finished_at",
      )
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const ActivityInput = z.object({ runId: z.string().uuid() });

/**
 * Élő aktivitás egy QA futáshoz — a hozzátartozó brain_workflow_run logjait,
 * státuszát és hibaüzenetét adja vissza, hogy a UI valós időben lássa mi folyik.
 */
export const getAuditQaRunActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ActivityInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: qaRun, error: qaErr } = await supabase
      .from("audit_qa_runs")
      .select("id, workflow_id, status")
      .eq("id", data.runId)
      .maybeSingle();
    if (qaErr) throw new Error(qaErr.message);
    if (!qaRun?.workflow_id) return { logs: [], status: qaRun?.status ?? "unknown", error: null, workerStatus: null };

    const { data: wfRun, error: wfErr } = await supabase
      .from("brain_workflow_runs")
      .select("status, logs, error, started_at, finished_at")
      .eq("workflow_id", qaRun.workflow_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (wfErr) throw new Error(wfErr.message);

    const logs = Array.isArray(wfRun?.logs)
      ? (wfRun!.logs as Array<{ ts: string; level: string; message: string }>)
      : [];

    return {
      logs,
      status: qaRun.status,
      workerStatus: wfRun?.status ?? null,
      error: wfRun?.error ?? null,
      startedAt: wfRun?.started_at ?? null,
      finishedAt: wfRun?.finished_at ?? null,
    };
  });


const IssuesInput = z.object({
  runId: z.string().uuid(),
  severity: z.array(z.string()).optional(),
  category: z.array(z.string()).optional(),
  language: z.string().optional(),
  skin: z.string().optional(),
  status: z.string().optional(),
});

export const listAuditQaIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IssuesInput.parse(i))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_qa_issues")
      .select("*")
      .eq("run_id", data.runId)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false });
    if (data.severity?.length) q = q.in("severity", data.severity);
    if (data.category?.length) q = q.in("category", data.category);
    if (data.language) q = q.eq("language", data.language);
    if (data.skin) q = q.eq("skin", data.skin);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const UpdateIssueInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "fixed", "wont_fix", "duplicate"]),
});
export const updateAuditQaIssueStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateIssueInput.parse(i))
  .handler(async ({ data, context }) => {
    const patch: { status: typeof data.status; resolved_at?: string } = { status: data.status };
    if (data.status === "fixed") patch.resolved_at = new Date().toISOString();
    const { error } = await context.supabase
      .from("audit_qa_issues")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PatchInput = z.object({
  runId: z.string().uuid(),
  issueIds: z.array(z.string().uuid()).min(1).max(200),
  includeScreenshots: z.boolean().default(true),
});

export const buildAuditQaPatchPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PatchInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: run, error: runErr } = await context.supabase
      .from("audit_qa_runs")
      .select("started_at, base_url")
      .eq("id", data.runId)
      .single();
    if (runErr || !run) throw new Error("Run nem található.");

    const { data: rows, error } = await context.supabase
      .from("audit_qa_issues")
      .select(
        "id, severity, category, page_url, language, skin, expected_language, detected_language, problematic_text, selector, ai_diagnosis, ai_suggested_fix, screenshot_path",
      )
      .in("id", data.issueIds);
    if (error) throw new Error(error.message);

    const issues: PatchIssue[] = [];
    for (const r of rows ?? []) {
      let signed: string | null = null;
      if (data.includeScreenshots && r.screenshot_path) {
        const { data: s } = await context.supabase.storage
          .from("audit-qa-screenshots")
          .createSignedUrl(r.screenshot_path, 60 * 60 * 24 * 7);
        signed = s?.signedUrl ?? null;
      }
      issues.push({
        id: r.id,
        severity: r.severity as PatchIssue["severity"],
        category: r.category,
        page_url: r.page_url,
        language: r.language,
        skin: r.skin,
        expected_language: r.expected_language,
        detected_language: r.detected_language,
        problematic_text: r.problematic_text,
        selector: r.selector,
        ai_diagnosis: r.ai_diagnosis,
        ai_suggested_fix: r.ai_suggested_fix,
        screenshot_signed_url: signed,
      });
    }

    const markdown = buildPatchPackage({
      runStartedAt: run.started_at,
      baseUrl: run.base_url,
      issues,
    });
    return { markdown, count: issues.length };
  });

// ─────────────────────────────────────────────────────────────
// Riport karbantartás: törlés + export
// ─────────────────────────────────────────────────────────────

const RunIdInput = z.object({ runId: z.string().uuid() });
const ExportRunInput = RunIdInput.extend({ allowSnapshot: z.boolean().default(false) });

/**
 * Egy QA riport teljes törlése.
 * - Futó (status='running'|'queued') futást NEM töröl.
 * - Törli a hozzátartozó screenshotokat a storage-ból.
 * - `audit_qa_issues` és `audit_qa_coverage` FK CASCADE-del automatikusan törlődik.
 */
export const deleteAuditQaRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RunIdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: run, error: runErr } = await supabase
      .from("audit_qa_runs")
      .select("id, status, started_at, updated_at")
      .eq("id", data.runId)
      .maybeSingle();
    if (runErr) throw new Error(runErr.message);
    if (!run) throw new Error("A riport nem található.");
    // Csak akkor blokkoljuk, ha a futás valóban friss (10 percen belül volt aktivitás).
    // A megrekedt „running" runok (worker leállt / timeout) így törölhetők.
    if (run.status === "running" || run.status === "queued") {
      const ts = (run.updated_at ?? run.started_at) as string | null;
      const lastActivity = ts ? new Date(ts).getTime() : 0;
      if (lastActivity && Date.now() - lastActivity < 10 * 60 * 1000) {
        throw new Error("Ez a futás még aktív (10 percen belül volt haladás). Várd meg, vagy állítsd le, mielőtt törlöd.");
      }
    }

    const { data: issueRows } = await supabase
      .from("audit_qa_issues")
      .select("screenshot_path")
      .eq("run_id", data.runId);
    const paths = (issueRows ?? [])
      .map((r) => r.screenshot_path)
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from("audit-qa-screenshots").remove(paths.slice(i, i + 100));
      }
    }

    const { error: delErr } = await supabase.from("audit_qa_runs").delete().eq("id", data.runId);
    if (delErr) throw new Error(delErr.message);
    return { ok: true, deletedScreenshots: paths.length };
  });

/** Teljes riport export (run + issues + coverage) JSON-ban. Képekhez 7 napos aláírt URL. */
export const exportAuditQaRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ExportRunInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: run, error: runErr } = await supabase
      .from("audit_qa_runs")
      .select("*")
      .eq("id", data.runId)
      .maybeSingle();
    if (runErr) throw new Error(runErr.message);
    if (!run) throw new Error("A riport nem található.");

    const terminalStatuses = new Set(["completed", "failed", "timed_out", "cancelled"]);
    const isFinal = terminalStatuses.has(String(run.status));
    if (!isFinal && !data.allowSnapshot) {
      throw new Error(
        "Ez a riport még nem végleges, ezért nem exportálható végleges JSON-ként. Ha régi running állapotban ragadt, töröld vagy indíts új futást.",
      );
    }

    const { data: issues, error: issErr } = await supabase
      .from("audit_qa_issues")
      .select("*")
      .eq("run_id", data.runId)
      .order("created_at", { ascending: true });
    if (issErr) throw new Error(issErr.message);

    const { data: coverage } = await supabase
      .from("audit_qa_coverage")
      .select("*")
      .eq("run_id", data.runId);

    type IssueExport = (NonNullable<typeof issues>[number]) & { screenshot_signed_url: string | null };
    const withSigned: IssueExport[] = [];
    for (const iss of issues ?? []) {
      let signed: string | null = null;
      if (iss.screenshot_path) {
        const { data: s } = await supabase.storage
          .from("audit-qa-screenshots")
          .createSignedUrl(iss.screenshot_path, 60 * 60 * 24 * 7);
        signed = s?.signedUrl ?? null;
      }
      withSigned.push({ ...iss, screenshot_signed_url: signed });
    }

    const coverageRows = coverage ?? [];
    const warnings: string[] = [];
    if (!isFinal) warnings.push("Ez csak élő pillanatkép, nem végleges QA riport.");
    if (Number(run.total_pages_visited ?? 0) !== coverageRows.length) {
      warnings.push("A run számláló és a coverage sorok száma eltér, ezért a coverage lista az irányadó.");
    }
    if (Number(run.total_issues_found ?? 0) !== withSigned.length) {
      warnings.push("A run hibaszámláló és az exportált issue sorok száma eltér, ezért az issues lista az irányadó.");
    }

    return {
      exportedAt: new Date().toISOString(),
      export: {
        type: isFinal ? "final" : "snapshot",
        is_final: isFinal,
        status: run.status,
        actual_issue_count: withSigned.length,
        actual_coverage_count: coverageRows.length,
        warnings,
      },
      run,
      issues: withSigned,
      coverage: coverageRows,
    };
  });
