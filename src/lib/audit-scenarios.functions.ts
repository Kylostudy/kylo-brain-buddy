// Kylo Audit — teszt-forgatókönyvek ("egy motor, sok forgatókönyv").
//
// A stabil record-replay motort NEM duplikáljuk workflow-nként. Helyette a
// teszteket adatbázisban tárolt forgatókönyvekké alakítjuk:
//   - "block"    = újrahasznosítható építőkocka (pl. belépés, előfizetés)
//   - "scenario" = konkrét teszt (előjáték-kockák + saját lépések + elvárások)
//
// Minden forgatókönyvhöz tartozhat egy háttér-workflow, amelyben a böngészős
// felvétel készül; a felvett lépéseket onnan importáljuk a forgatókönyvbe.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SCENARIO_MONITOR = "kylo-scenario";

type Ctx = { supabase: any; userId: string };

async function tenantOf(ctx: Ctx): Promise<string> {
  const { data: prof } = await ctx.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", ctx.userId)
    .single();
  if (!prof?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
  return prof.tenant_id as string;
}

// ─────────────────────────────────────────────────────────────
// Lekérdezés
// ─────────────────────────────────────────────────────────────

export const listScenarioLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await tenantOf(context as Ctx);
    const supabase = (context as Ctx).supabase;

    const [scenarios, examTypes, verdicts] = await Promise.all([
      supabase
        .from("audit_scenarios")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("audit_exam_types")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("audit_scenario_verdicts")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    return {
      scenarios: scenarios.data ?? [],
      examTypes: examTypes.data ?? [],
      verdicts: verdicts.data ?? [],
    };
  });

// ─────────────────────────────────────────────────────────────
// Forgatókönyv mentése / törlése
// ─────────────────────────────────────────────────────────────

const UpsertScenario = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  featureTag: z.string().max(80).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  kind: z.enum(["block", "scenario"]).default("scenario"),
  baseUrl: z.string().url().default("https://kylo.study"),
  steps: z.array(z.record(z.string(), z.unknown())).default([]),
  preludeBlockIds: z.array(z.string().uuid()).default([]),
  expectations: z.record(z.string(), z.unknown()).default({}),
  runPerExam: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const upsertScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertScenario.parse(i))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context as Ctx);
    const supabase = (context as Ctx).supabase;

    const row = {
      tenant_id: tenantId,
      name: data.name.trim(),
      feature_tag: data.featureTag?.trim() || null,
      description: data.description ?? null,
      kind: data.kind,
      base_url: data.baseUrl,
      steps: data.steps as never,
      prelude_block_ids: data.preludeBlockIds,
      expectations: data.expectations as never,
      run_per_exam: data.runPerExam,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };

    if (data.id) {
      const { error } = await supabase.from("audit_scenarios").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabase
      .from("audit_scenarios")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created!.id as string };
  });

export const deleteScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context as Ctx).supabase
      .from("audit_scenarios")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabase = (context as Ctx).supabase;
    const { data: src, error } = await supabase
      .from("audit_scenarios")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !src) throw new Error(error?.message || "A forgatókönyv nem található.");

    const { id, created_at, updated_at, workflow_id, name, ...rest } = src as Record<string, unknown>;
    const { data: created, error: insErr } = await supabase
      .from("audit_scenarios")
      .insert({ ...rest, name: `${name as string} (másolat)` })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { id: created!.id as string };
  });

// ─────────────────────────────────────────────────────────────
// Nyelvvizsga-típusok
// ─────────────────────────────────────────────────────────────

const UpsertExam = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  expectedFeatures: z.array(z.string().min(1)).default([]),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const upsertExamType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertExam.parse(i))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context as Ctx);
    const supabase = (context as Ctx).supabase;
    const row = {
      tenant_id: tenantId,
      code: data.code.trim(),
      label: data.label.trim(),
      expected_features: data.expectedFeatures,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
    if (data.id) {
      const { error } = await supabase.from("audit_exam_types").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabase
      .from("audit_exam_types")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created!.id as string };
  });

export const deleteExamType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context as Ctx).supabase
      .from("audit_exam_types")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────
// Felvétel: háttér-workflow + lépések importja
// ─────────────────────────────────────────────────────────────

/** Létrehozza (vagy visszaadja) a forgatókönyvhöz tartozó felvételi workflow-t. */
export const ensureScenarioWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ scenarioId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context as Ctx);
    const supabase = (context as Ctx).supabase;

    const { data: sc, error } = await supabase
      .from("audit_scenarios")
      .select("id, name, base_url, workflow_id, steps")
      .eq("id", data.scenarioId)
      .single();
    if (error || !sc) throw new Error(error?.message || "A forgatókönyv nem található.");
    if (sc.workflow_id) return { workflowId: sc.workflow_id as string };

    const { data: created, error: wfErr } = await supabase
      .from("workflows")
      .insert({
        tenant_id: tenantId,
        module: "audit",
        name: `Forgatókönyv felvétel — ${sc.name}`,
        spec: {
          monitor_type: SCENARIO_MONITOR,
          scenario_id: sc.id,
          start_url: sc.base_url,
          recorded_actions: Array.isArray(sc.steps) ? sc.steps : [],
        } as never,
      })
      .select("id")
      .single();
    if (wfErr) throw new Error(wfErr.message);

    await supabase
      .from("audit_scenarios")
      .update({ workflow_id: created!.id })
      .eq("id", sc.id);

    return { workflowId: created!.id as string };
  });

/** A felvételi workflow-ban rögzített lépéseket bemásolja a forgatókönyvbe. */
export const importRecordedSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ scenarioId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabase = (context as Ctx).supabase;
    const { data: sc, error } = await supabase
      .from("audit_scenarios")
      .select("id, workflow_id")
      .eq("id", data.scenarioId)
      .single();
    if (error || !sc) throw new Error(error?.message || "A forgatókönyv nem található.");
    if (!sc.workflow_id) throw new Error("Ehhez a forgatókönyvhöz még nincs felvétel.");

    const { data: wf } = await supabase
      .from("workflows")
      .select("spec")
      .eq("id", sc.workflow_id)
      .maybeSingle();
    const spec = (wf?.spec as Record<string, unknown> | null) ?? {};
    const actions = Array.isArray(spec.recorded_actions) ? spec.recorded_actions : [];
    if (actions.length === 0) throw new Error("A felvétel üres — nincs mit importálni.");

    const { error: upErr } = await supabase
      .from("audit_scenarios")
      .update({ steps: actions as never })
      .eq("id", sc.id);
    if (upErr) throw new Error(upErr.message);
    return { stepCount: actions.length };
  });

// ─────────────────────────────────────────────────────────────
// Futtatás
// ─────────────────────────────────────────────────────────────

const StartRun = z.object({
  scenarioId: z.string().uuid(),
  proxyId: z.string().uuid().nullable().optional(),
  examCodes: z.array(z.string().min(1)).nullable().optional(),
});

export const startScenarioRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartRun.parse(i))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context as Ctx);
    const supabase = (context as Ctx).supabase;

    const { data: sc, error } = await supabase
      .from("audit_scenarios")
      .select("*")
      .eq("id", data.scenarioId)
      .single();
    if (error || !sc) throw new Error(error?.message || "A forgatókönyv nem található.");

    // Előjáték-kockák lépései a saját lépések elé fűzve.
    const preludeIds = (sc.prelude_block_ids as string[] | null) ?? [];
    let composed: unknown[] = [];
    if (preludeIds.length > 0) {
      const { data: blocks } = await supabase
        .from("audit_scenarios")
        .select("id, steps")
        .in("id", preludeIds);
      const byId = new Map((blocks ?? []).map((b: any) => [b.id as string, b.steps]));
      for (const bid of preludeIds) {
        const s = byId.get(bid);
        if (Array.isArray(s)) composed = composed.concat(s);
      }
    }
    const ownSteps = Array.isArray(sc.steps) ? (sc.steps as unknown[]) : [];
    composed = composed.concat(ownSteps);
    if (composed.length === 0) throw new Error("A forgatókönyvnek nincs egyetlen lépése sem.");

    // Melyik vizsgákra futtassunk? (csak ha a forgatókönyv így van beállítva)
    let exams: Array<{ code: string; label: string; expected_features: string[] }> = [];
    if (sc.run_per_exam) {
      const q = supabase
        .from("audit_exam_types")
        .select("code, label, expected_features")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      const { data: allExams } = await q;
      exams = (allExams ?? []) as never;
      if (data.examCodes && data.examCodes.length > 0) {
        const wanted = new Set(data.examCodes);
        exams = exams.filter((e) => wanted.has(e.code));
      }
    }
    const targets: Array<{ code: string | null; label: string | null; features: string[] }> =
      exams.length > 0
        ? exams.map((e) => ({ code: e.code, label: e.label, features: e.expected_features ?? [] }))
        : [{ code: null, label: null, features: [] }];

    // Proxy: ha nem kaptunk, az első aktívat használjuk.
    let proxyId = data.proxyId ?? null;
    if (!proxyId) {
      const { data: p } = await supabase
        .from("proxies")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("label", { ascending: true })
        .limit(1)
        .maybeSingle();
      proxyId = p?.id ?? null;
    }

    const runIds: string[] = [];
    for (const t of targets) {
      const spec = {
        monitor_type: SCENARIO_MONITOR,
        scenario_id: sc.id,
        scenario_name: sc.name,
        account_label: t.label ? `${sc.name} · ${t.label}` : sc.name,
        brain_task: { task_type: "record_replay_login", platform: "kylo-study" },
        recorded_actions: composed,
        kylo_scenario: {
          base_url: sc.base_url,
          feature_tag: sc.feature_tag,
          expectations: sc.expectations,
          exam_code: t.code,
          exam_label: t.label,
          expected_features: t.features,
        },
      };

      const { data: run, error: qErr } = await supabase
        .from("brain_workflow_runs")
        .insert({
          workflow_id: sc.workflow_id,
          tenant_id: tenantId,
          module: "audit",
          runner: "docker",
          status: "queued",
          proxy_id: proxyId,
          spec_snapshot: spec as never,
          started_at: new Date().toISOString(),
          logs: [
            {
              ts: new Date().toISOString(),
              level: "info",
              message: `Forgatókönyv sorba téve: ${sc.name}${t.label ? ` · ${t.label}` : ""} — ${composed.length} lépés`,
            },
          ] as never,
        })
        .select("id")
        .single();
      if (qErr) throw new Error(qErr.message);
      runIds.push(run!.id as string);
    }

    return { runIds, count: runIds.length, stepCount: composed.length };
  });
