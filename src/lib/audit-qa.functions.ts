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
  maxPagesPerCombo: z.number().int().min(1).max(1000).default(300),
  // Új: bejelentkezéshez a UI-ból kapott email/password (titkosítva mentjük a workflow_credentials-be).
  // Ha üres a password, a workflow-hoz korábban mentett jelszót használjuk.
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().max(500).optional().or(z.literal("")),
  // Diff-mód: ha true, a worker minden oldal előtt megnézi, hogy egy korábbi
  // BEFEJEZETT run ugyanezt a (url, nyelv, skin, tartalom-hash) kombót már
  // elemezte-e — ha igen, a cached hibákat klónozza AI-hívás nélkül.
  diffMode: z.boolean().default(true),
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
          diffMode: data.diffMode,
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

    // 2c) Elvárt oldalak (checklista) betöltése — a worker célzottan is meglátogatja azokat,
    // amiket a BFS nem talált meg. Csak a tenanthoz tartozó lista megy át a specbe.
    const { data: expectedRoutes } = await supabase
      .from("audit_qa_expected_routes")
      .select("path, requires_auth")
      .eq("tenant_id", tenantId)
      .order("path", { ascending: true });

    // 3) queued brain_workflow_runs (a worker ezt claimolja)
    const spec = {
      monitor_type: "kylo-study-qa",
      audit_qa: {
        run_id: run.id,
        base_url: data.baseUrl,
        languages: data.languages,
        skins: data.skins,
        max_pages_per_combo: data.maxPagesPerCombo,
        max_clicks_per_page: 10,
        cost_cap_usd: data.costCapUsd,
        diff_mode: data.diffMode,
        expected_routes: (expectedRoutes ?? []).map((r) => ({
          path: r.path,
          requires_auth: !!r.requires_auth,
        })),
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
          message: `Kylo.study QA futás sorba téve — run_id=${run.id} · ${spec.audit_qa.expected_routes.length} elvárt oldal`,
        },
      ] as never,
    });
    if (qErr) throw new Error(qErr.message);

    return { runId: run.id, startedAt: run.started_at, baseUrl: run.base_url };
  });

// ─────────────────────────────────────────────────────────────
// Elvárt oldalak (checklista) — CRUD + coverage mátrix
// ─────────────────────────────────────────────────────────────

export const listExpectedRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_qa_expected_routes")
      .select("id, path, note, requires_auth, created_at, updated_at")
      .order("path", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const UpsertExpectedRoutesInput = z.object({
  // Egész lista, egyszerű szöveges import: soronként egy path (opcionálisan " # jegyzet").
  // A `requires_auth` alapból `true` a `/`-től eltérőnek — a UI-ban módosítható.
  paths: z.array(
    z.object({
      path: z.string().min(1).max(500),
      note: z.string().max(500).nullable().optional(),
      requires_auth: z.boolean().optional(),
    }),
  ),
  replaceAll: z.boolean().default(true),
});

export const upsertExpectedRoutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertExpectedRoutesInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant.");
    const tenantId = prof.tenant_id;

    // normalizálás: mindig `/`-vel kezdődjön, szóközök trim
    const clean = data.paths
      .map((p) => ({
        path: (p.path.startsWith("/") ? p.path : `/${p.path}`).trim().replace(/\s+/g, ""),
        note: p.note?.trim() || null,
        requires_auth: p.requires_auth ?? p.path !== "/",
      }))
      .filter((p) => p.path.length > 0);

    if (data.replaceAll) {
      const { error: delErr } = await supabase
        .from("audit_qa_expected_routes")
        .delete()
        .eq("tenant_id", tenantId);
      if (delErr) throw new Error(delErr.message);
    }

    if (clean.length === 0) return { ok: true, count: 0 };

    const rows = clean.map((p) => ({
      tenant_id: tenantId,
      path: p.path,
      note: p.note,
      requires_auth: p.requires_auth,
    }));
    const { error } = await supabase
      .from("audit_qa_expected_routes")
      .upsert(rows as never, { onConflict: "tenant_id,path" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

// Egy elvárt sablon (pl. `/kviz/:id`) illeszkedik-e egy konkrét URL path-hoz.
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) return "[^/]+";
      if (seg === "*") return ".*";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}/?$`);
}

function urlToPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

const CoverageMatrixInput = z.object({ runId: z.string().uuid() });

/**
 * Lefedettségi mátrix: sorok = elvárt route-ok (+ „ismeretlen" bejárt URL-ek),
 * oszlopok = nyelv×skin kombók, cellák = { visited, issueCount, urls[] }.
 */
export const getAuditQaCoverageMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CoverageMatrixInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const [{ data: run }, { data: expected }, { data: coverage }, { data: issues }] =
      await Promise.all([
        supabase.from("audit_qa_runs").select("config, base_url").eq("id", data.runId).maybeSingle(),
        supabase
          .from("audit_qa_expected_routes")
          .select("path, note, requires_auth")
          .order("path", { ascending: true }),
        supabase
          .from("audit_qa_coverage")
          .select("url, language, skin, interactions_count, visited_at")
          .eq("run_id", data.runId),
        supabase
          .from("audit_qa_issues")
          .select("page_url, language, skin, severity, status")
          .eq("run_id", data.runId),
      ]);

    if (!run) throw new Error("Run nem található.");

    // Config-alapú combo lista (a run indulásakor kért nyelvek×skinek)
    const cfg = (run.config ?? {}) as { languages?: string[]; skins?: string[] };
    const langs: string[] = Array.isArray(cfg.languages) && cfg.languages.length > 0 ? cfg.languages : ["hu"];
    const skins: string[] = Array.isArray(cfg.skins) && cfg.skins.length > 0 ? cfg.skins : ["default"];
    const combos = langs.flatMap((l) => skins.map((s) => ({ language: l, skin: s })));

    const expectedRows = expected ?? [];
    const coverageRows = coverage ?? [];
    const issueRows = issues ?? [];

    // Előre gyorsítás: bejárt URL path-ok + lang/skin.
    const covList = coverageRows.map((c) => ({
      path: urlToPath(c.url as string),
      url: c.url as string,
      language: (c.language ?? null) as string | null,
      skin: (c.skin ?? null) as string | null,
    }));

    // URL → open hibák száma
    const openIssueByUrl = new Map<string, number>();
    for (const iss of issueRows) {
      if (iss.status !== "open") continue;
      const key = `${urlToPath(iss.page_url as string)}|${iss.language ?? ""}|${iss.skin ?? ""}`;
      openIssueByUrl.set(key, (openIssueByUrl.get(key) ?? 0) + 1);
    }

    type Cell = { visited: boolean; issueCount: number; urls: string[] };
    type Row = {
      path: string;
      note: string | null;
      requires_auth: boolean;
      isExpected: boolean;
      cells: Record<string, Cell>; // key = `${language}|${skin}`
    };

    const rows: Row[] = [];
    const matchedCoverageIdx = new Set<number>();

    for (const exp of expectedRows) {
      const rx = patternToRegex(exp.path);
      const cells: Record<string, Cell> = {};
      for (const combo of combos) {
        const cell: Cell = { visited: false, issueCount: 0, urls: [] };
        covList.forEach((c, idx) => {
          if (c.language !== combo.language || c.skin !== combo.skin) return;
          if (!rx.test(c.path)) return;
          matchedCoverageIdx.add(idx);
          cell.visited = true;
          cell.urls.push(c.url);
          cell.issueCount += openIssueByUrl.get(`${c.path}|${combo.language}|${combo.skin}`) ?? 0;
        });
        cells[`${combo.language}|${combo.skin}`] = cell;
      }
      rows.push({
        path: exp.path,
        note: exp.note ?? null,
        requires_auth: !!exp.requires_auth,
        isExpected: true,
        cells,
      });
    }

    // „Ismeretlen" — bejárt path-ok, amik semmilyen elvárt patternhez nem passzoltak.
    const orphanPaths = new Map<string, Row>();
    covList.forEach((c, idx) => {
      if (matchedCoverageIdx.has(idx)) return;
      const key = c.path;
      let row = orphanPaths.get(key);
      if (!row) {
        row = {
          path: key,
          note: null,
          requires_auth: false,
          isExpected: false,
          cells: Object.fromEntries(combos.map((cb) => [`${cb.language}|${cb.skin}`, { visited: false, issueCount: 0, urls: [] } as Cell])),
        };
        orphanPaths.set(key, row);
      }
      const cellKey = `${c.language}|${c.skin}`;
      const cell = row.cells[cellKey];
      if (cell) {
        cell.visited = true;
        cell.urls.push(c.url);
        cell.issueCount += openIssueByUrl.get(`${key}|${c.language}|${c.skin}`) ?? 0;
      }
    });
    for (const row of orphanPaths.values()) rows.push(row);

    return {
      combos,
      rows,
      totals: {
        expectedCount: expectedRows.length,
        coveredCount: rows.filter((r) => r.isExpected && Object.values(r.cells).some((c) => c.visited)).length,
        orphanCount: orphanPaths.size,
      },
    };
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
        "id, status, base_url, config, total_pages_visited, total_issues_found, total_cost_usd, cost_cap_usd, started_at, updated_at, finished_at, ai_explanation",
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

// ─────────────────────────────────────────────────────────────
// Sign Up-stílusú riportolás: tömeges törlés, összesítés, AI-elemzés
// ─────────────────────────────────────────────────────────────

const BulkDeleteInput = z.object({ runIds: z.array(z.string().uuid()).min(1).max(200) });

/** Több QA riport törlése egyszerre (kijelöléses tömeges törlés a listában). */
export const deleteAuditQaRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkDeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: runs, error: runsErr } = await supabase
      .from("audit_qa_runs")
      .select("id, status, started_at, updated_at")
      .in("id", data.runIds);
    if (runsErr) throw new Error(runsErr.message);

    const deletable: string[] = [];
    let skippedActive = 0;
    for (const run of runs ?? []) {
      if (run.status === "running" || run.status === "queued") {
        const ts = (run.updated_at ?? run.started_at) as string | null;
        const last = ts ? new Date(ts).getTime() : 0;
        if (last && Date.now() - last < 10 * 60 * 1000) {
          skippedActive += 1;
          continue;
        }
      }
      deletable.push(run.id);
    }
    if (deletable.length === 0) return { deleted: 0, skippedActive };

    const { data: issueRows } = await supabase
      .from("audit_qa_issues")
      .select("screenshot_path")
      .in("run_id", deletable);
    const paths = (issueRows ?? []).map((r) => r.screenshot_path).filter((p): p is string => !!p);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from("audit-qa-screenshots").remove(paths.slice(i, i + 100));
    }

    const { error: delErr } = await supabase.from("audit_qa_runs").delete().in("id", deletable);
    if (delErr) throw new Error(delErr.message);
    return { deleted: deletable.length, skippedActive, deletedScreenshots: paths.length };
  });

/**
 * Összesítés az összes QA futásról: státusz-bontás, súlyosság szerinti
 * hibaszám, nyelvenkénti bontás és a leggyakoribb hibák.
 */
export const getAuditQaSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: runs, error } = await supabase
      .from("audit_qa_runs")
      .select("id, status, config, total_pages_visited, total_issues_found, total_cost_usd, started_at")
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const list = runs ?? [];
    const byStatus: Record<string, number> = {};
    let pages = 0;
    let cost = 0;
    for (const r of list) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      pages += Number(r.total_pages_visited ?? 0);
      cost += Number(r.total_cost_usd ?? 0);
    }

    const runIds = list.map((r) => r.id);
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byLang: Record<string, { total: number; critical: number }> = {};
    let openIssues = 0;
    if (runIds.length > 0) {
      const { data: issues, error: issErr } = await supabase
        .from("audit_qa_issues")
        .select("severity, category, language, status")
        .in("run_id", runIds)
        .limit(5000);
      if (issErr) throw new Error(issErr.message);
      for (const i of issues ?? []) {
        bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
        byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
        const lang = i.language ?? "?";
        byLang[lang] = byLang[lang] ?? { total: 0, critical: 0 };
        byLang[lang].total += 1;
        if (i.severity === "critical") byLang[lang].critical += 1;
        if (i.status === "open") openIssues += 1;
      }
    }

    return {
      total: list.length,
      byStatus,
      bySeverity,
      byCategory,
      byLang,
      openIssues,
      totalPages: pages,
      totalCostUsd: Number(cost.toFixed(2)),
    };
  });

/**
 * Emberi nyelvű (magyar) elemzés egy QA futásról — ugyanaz a logika, mint a
 * Kylo Sign Up riportnál. Az eredményt eltároljuk, hogy ne kelljen újra hívni.
 */
export const explainAuditQaRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ runId: z.string().uuid(), force: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: run, error } = await supabase
      .from("audit_qa_runs")
      .select(
        "id, status, base_url, config, total_pages_visited, total_issues_found, total_cost_usd, started_at, finished_at, ai_explanation, workflow_id",
      )
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("A futás nem található.");

    const existing = (run.ai_explanation ?? null) as { text?: string; generated_at?: string } | null;
    if (!data.force && existing?.text) {
      return { text: existing.text, generated_at: existing.generated_at ?? null, cached: true };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Hiányzik a LOVABLE_API_KEY.");

    const { data: issues } = await supabase
      .from("audit_qa_issues")
      .select("severity, category, language, skin, page_url, problematic_text, ai_diagnosis, ai_suggested_fix")
      .eq("run_id", data.runId)
      .order("severity", { ascending: true })
      .limit(60);

    let workerError: string | null = null;
    if (run.workflow_id) {
      const { data: wfRun } = await supabase
        .from("brain_workflow_runs")
        .select("error, status")
        .eq("workflow_id", run.workflow_id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      workerError = (wfRun?.error as string | null) ?? null;
    }

    const trim = (v: unknown, max: number) => {
      const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
      return s && s.length > max ? s.slice(0, max) + "…[levágva]" : s;
    };

    const ctx = {
      status: run.status,
      base_url: run.base_url,
      started_at: run.started_at,
      finished_at: run.finished_at,
      config: trim(run.config, 1500),
      pages_visited: run.total_pages_visited,
      issues_found: run.total_issues_found,
      cost_usd: run.total_cost_usd,
      worker_error: trim(workerError, 1500),
      issues: trim(issues ?? [], 9000),
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Te egy QA-elemző vagy. Egy automata weboldal-ellenőrző (Kylo.study QA) futás nyers adatait kapod JSON-ban: " +
              "nyelvek, skinek, bejárt oldalak és a talált fordítási/vizuális hibák. " +
              "Írj MAGYARUL, közérthetően, technikai zsargon nélkül egy rövid elemzést egy nem programozó olvasónak. " +
              "Szerkezet (markdown): 1) egy mondatos verdikt, 2) 'Mi ment jól', 3) 'Legfontosabb hibák' — nyelv/oldal szerint csoportosítva, " +
              "4) 'Valószínű ok' 1-2 mondatban, 5) 'Javasolt következő lépés'. Ne találj ki adatot. Max 250 szó.",
          },
          { role: "user", content: JSON.stringify(ctx) },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Az AI szolgáltatás túlterhelt, próbáld pár perc múlva.");
      if (res.status === 402) throw new Error("Elfogytak az AI kreditek a munkaterületen.");
      throw new Error(`AI hiba (${res.status}): ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Az AI üres választ adott.");

    const generated_at = new Date().toISOString();
    await supabase
      .from("audit_qa_runs")
      .update({ ai_explanation: { text, generated_at } })
      .eq("id", data.runId);

    return { text, generated_at, cached: false };
  });

/**
 * Összesített hibanapló: az utolsó néhány futás összes hibája egy listában,
 * hogy egy kattintással vágólapra lehessen másolni a fejlesztésnek.
 */
export const listAuditQaAggregatedIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        runLimit: z.number().int().min(1).max(50).default(1),
        onlyOpen: z.boolean().default(true),
        dedupe: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Csak befejezett futásokat összesítünk — a félkész futás félrevezető darabszámot adna.
    const { data: runs, error } = await supabase
      .from("audit_qa_runs")
      .select("id, started_at, finished_at, status, config")
      .in("status", ["completed", "failed", "cancelled"])
      .order("started_at", { ascending: false })
      .limit(data.runLimit);
    if (error) throw new Error(error.message);
    const list = runs ?? [];
    if (list.length === 0) return { runs: [], issues: [], truncated: false, totalRaw: 0 };

    const runIds = list.map((r) => r.id);
    const PAGE = 1000;
    const MAX = 10000;
    const all: Array<Record<string, unknown>> = [];
    let truncated = false;
    for (let from = 0; from < MAX; from += PAGE) {
      let q = supabase
        .from("audit_qa_issues")
        .select(
          "id, run_id, severity, category, language, skin, page_url, problematic_text, ai_diagnosis, ai_suggested_fix, status, dedupe_hash, occurrence_count, created_at",
        )
        .in("run_id", runIds);
      if (data.onlyOpen) q = q.not("status", "in", "(resolved,ignored,fixed)");
      const { data: page, error: issErr } = await q
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (issErr) throw new Error(issErr.message);
      const rows = page ?? [];
      all.push(...(rows as Array<Record<string, unknown>>));
      if (rows.length < PAGE) break;
      if (from + PAGE >= MAX) truncated = true;
    }

    const totalRaw = all.length;
    let issues = all;
    if (data.dedupe) {
      const seen = new Set<string>();
      issues = all.filter((row) => {
        const key = String(
          row["dedupe_hash"] ?? `${row["page_url"]}|${row["category"]}|${row["problematic_text"]}`,
        );
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return {
      runs: list.map((r) => ({
        id: r.id,
        started_at: r.started_at,
        finished_at: r.finished_at,
        status: r.status,
      })),
      issues: issues as unknown as Array<{
        id: string;
        run_id: string;
        severity: string;
        category: string;
        language: string | null;
        skin: string | null;
        page_url: string;
        problematic_text: string | null;
        ai_diagnosis: string | null;
        ai_suggested_fix: string | null;
        status: string;
        occurrence_count: number | null;
      }>,
      truncated,
      totalRaw,
    };
  });

