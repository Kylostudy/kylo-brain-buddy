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
  maxPagesPerCombo: z.number().int().min(1).max(500).default(60),
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

    // 2) queued brain_workflow_runs (a worker ezt claimolja)
    const spec = {
      monitor_type: "kylo-study-qa",
      audit_qa: {
        run_id: run.id,
        base_url: data.baseUrl,
        languages: data.languages,
        skins: data.skins,
        max_pages_per_combo: data.maxPagesPerCombo,
        cost_cap_usd: data.costCapUsd,
      },
    };
    const { error: qErr } = await supabase.from("brain_workflow_runs").insert({
      workflow_id: data.workflowId ?? "00000000-0000-0000-0000-000000000000",
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

export const listAuditQaRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_qa_runs")
      .select(
        "id, status, base_url, config, total_pages_visited, total_issues_found, total_cost_usd, cost_cap_usd, started_at, finished_at",
      )
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
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
