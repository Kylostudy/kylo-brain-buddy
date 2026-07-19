// Kylo Audit QA — ütemezett futások CRUD server functionjei.
// A UI innen kezeli a saját tenant `audit_qa_schedules` sorait; RLS gondoskodik
// arról, hogy mindenki csak a sajátját lássa. A cron-időzítést croner számolja.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Cron } from "croner";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CRON_RE = /^(\S+\s+){4}\S+$/; // 5 mező, whitespace elválasztva

function computeNextRunAt(cronExpr: string, timezone: string, from: Date = new Date()): string {
  const job = new Cron(cronExpr, { timezone });
  const next = job.nextRun(from);
  if (!next) throw new Error("A cron kifejezés nem ad következő időpontot.");
  return next.toISOString();
}

async function getTenantId(supabase: { from: (t: string) => { select: (c: string) => { eq: (col: string, v: unknown) => { single: () => Promise<{ data: { tenant_id: string | null } | null; error: unknown }> } } } }, userId: string) {
  const { data, error } = await supabase.from("profiles").select("tenant_id").eq("id", userId).single();
  if (error || !data?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
  return data.tenant_id as string;
}

// ─── LIST ─────────────────────────────────────────────────────
export const listAuditQaSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_qa_schedules")
      .select(
        "id, name, enabled, cron_expression, timezone, base_url, languages, skins, diff_mode, cost_cap_usd, max_pages_per_combo, preset, last_run_at, last_run_id, last_run_status, next_run_at, created_at, updated_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ─── UPSERT ───────────────────────────────────────────────────
const UpsertScheduleInput = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  cronExpression: z.string().regex(CRON_RE, "5-mezős cron kifejezés kell (pl. `0 3 * * *`)."),
  timezone: z.string().default("Europe/Budapest"),
  baseUrl: z.string().url().default("https://kylo.study"),
  languages: z.array(z.string().min(2)).min(1),
  skins: z.array(z.string().min(1)).min(1),
  diffMode: z.boolean().default(true),
  costCapUsd: z.number().positive().max(500).default(50),
  maxPagesPerCombo: z.number().int().min(1).max(1000).default(300),
  preset: z.enum(["translation", "visual", "custom"]).nullable().optional(),
});

export const upsertAuditQaSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertScheduleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await getTenantId(supabase as never, userId);

    // Validáljuk a cron kifejezést és számoljuk a következő futást
    let nextRunAt: string;
    try {
      nextRunAt = computeNextRunAt(data.cronExpression, data.timezone);
    } catch (e) {
      throw new Error(`Hibás cron kifejezés: ${e instanceof Error ? e.message : String(e)}`);
    }

    const row = {
      tenant_id: tenantId,
      name: data.name,
      enabled: data.enabled,
      cron_expression: data.cronExpression,
      timezone: data.timezone,
      base_url: data.baseUrl,
      languages: data.languages,
      skins: data.skins,
      diff_mode: data.diffMode,
      cost_cap_usd: data.costCapUsd,
      max_pages_per_combo: data.maxPagesPerCombo,
      preset: data.preset ?? null,
      next_run_at: data.enabled ? nextRunAt : null,
    };

    if (data.id) {
      const { data: updated, error } = await supabase
        .from("audit_qa_schedules")
        .update(row as never)
        .eq("id", data.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: updated.id as string, nextRunAt };
    }

    const { data: created, error } = await supabase
      .from("audit_qa_schedules")
      .insert(row as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string, nextRunAt };
  });

// ─── DELETE ───────────────────────────────────────────────────
const IdInput = z.object({ id: z.string().uuid() });

export const deleteAuditQaSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("audit_qa_schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── TOGGLE ENABLED ───────────────────────────────────────────
const ToggleInput = z.object({ id: z.string().uuid(), enabled: z.boolean() });

export const toggleAuditQaSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Ha újra bekapcsoljuk, számoljuk újra a next_run_at-et.
    const { data: existing, error: readErr } = await supabase
      .from("audit_qa_schedules")
      .select("cron_expression, timezone")
      .eq("id", data.id)
      .single();
    if (readErr || !existing) throw new Error(readErr?.message || "Ütemezés nem található.");

    const nextRunAt = data.enabled
      ? computeNextRunAt(existing.cron_expression as string, (existing.timezone as string) || "Europe/Budapest")
      : null;

    const { error } = await supabase
      .from("audit_qa_schedules")
      .update({ enabled: data.enabled, next_run_at: nextRunAt } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, nextRunAt };
  });
