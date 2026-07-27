// Kylo Sign Up — szerver-fn-ek.
//
// Egyetlen "Kylo Sign Up" workflow tenantonként. Minden futásnál:
//   - váltogatva "puppy-cat" / "alaszka" skin
//   - a workflow-ban tárolt számláló szerint körbeforgatva választunk egy aktív proxyt
//   - a Gmail alap címhez plusz-alias-t generálunk: sunyika.crypto+kylo{N}@gmail.com
//   - a proxy országa alapján nyelvet választunk (?lang= paraméter)
//
// A rotáció állapota a workflows.spec-ben él (kylo_signup mező), így remixelve
// vagy exportálva átvihető, és nem kell külön tábla.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptString } from "@/lib/credentials/crypto.server";
import { loadProxyUrlServer } from "@/lib/proxies.functions";

const BASE_GMAIL = "sunyika.crypto@gmail.com";
const SIGNUP_MONITOR = "kylo-study-signup";
const SKIN_ORDER = ["puppy-cat", "alaszka"] as const;
const ENGLISH_SIGNUP_COUNTRIES = new Set(["US", "GB", "CA", "AU", "NZ", "IE"]);

// Proxy ország → Kylo felületi nyelv (lang query param).
// A country cím a natív nyelvet kapja; angol nyelvterületen en-GB-t (a Kylo
// master angolja en-GB). Kétnyelvű / hivatalosan angol területeken (SG, HK)
// a helyi nyelvet küldjük, mert az a jellemző első választás.
const COUNTRY_TO_LANG: Record<string, string> = {
  // angol
  US: "en-GB",
  GB: "en-GB",
  CA: "en-GB",
  AU: "en-GB",
  NZ: "en-GB",
  IE: "en-GB",
  SG: "en-GB",
  // kínai / kelet-ázsiai
  TW: "zh-TW",
  HK: "zh-HK",
  JP: "ja",
  // európai
  HU: "hu",
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr-FR",
  ES: "es",
  IT: "it",
  NL: "nl",
  PL: "pl",
  SE: "sv",
  FI: "fi",
  NO: "no",
  DK: "da",
  CZ: "cs",
  RO: "ro",
  TR: "tr",
  GR: "el",
  PT: "pt-PT",
  BE: "nl",
  SK: "sk",
  BG: "bg",
  HR: "hr",
  SI: "sl",
  LT: "lt",
  LV: "lv",
  EE: "et",
  UA: "uk",
  RU: "ru",
  KR: "ko",
  CN: "zh-CN",
  IN: "en-GB",
  ID: "id",
  TH: "th",
  VN: "vi",
  // Latin-Amerika
  BR: "pt-BR",
  CO: "es",
  MX: "es",
  AR: "es",
  CL: "es",
};

// Ország → fizetési deviza. A Kylo Stripe csak EUR / USD / CNY / RUB-ot fogad.
// Európa (UK-t is beleértve) = EUR, Kína = CNY, Oroszország = RUB, minden más = USD.
function currencyForCountry(cc: string | null): "EUR" | "USD" | "CNY" | "RUB" {
  if (!cc) return "USD";
  const c = cc.toUpperCase();
  const EUR = new Set([
    "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
    "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL",
    "NO", "PL", "PT", "RO", "SE", "SI", "SK", "TR",
  ]);
  if (EUR.has(c)) return "EUR";
  if (c === "CN") return "CNY";
  if (c === "RU") return "RUB";
  return "USD";
}


function langForCountry(cc: string | null): string {
  if (!cc) return "en-GB";
  return COUNTRY_TO_LANG[cc.toUpperCase()] || "en-GB";
}

function aliasFor(counter: number): string {
  // sunyika.crypto+kylo42@gmail.com
  const [local, domain] = BASE_GMAIL.split("@");
  return `${local}+kylo${counter}@${domain}`;
}

// Erős, könnyen olvasható tesztjelszó (elmentjük is a run spec-be, hogy a Gmail
// alapú megerősítés után is használható legyen).
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `Kylo!${out}`;
}

// A generált alias e-mail + jelszó párost eltároljuk (jelszó titkosítva),
// hogy a későbbi funkcionális tesztek már belépéssel induljanak, ne új
// regisztrációval.
async function saveTestAccount(
  supabase: { from: (t: string) => any },
  row: {
    tenantId: string;
    workflowId: string;
    runId: string;
    email: string;
    password: string;
    runIndex: number;
    skin: string;
    country: string | null;
    lang: string;
    currency: string;
  },
) {
  try {
    const enc = await encryptString(row.password);
    await supabase
      .from("audit_test_accounts")
      .upsert(
        {
          tenant_id: row.tenantId,
          workflow_id: row.workflowId,
          run_id: row.runId,
          email: row.email,
          password_ciphertext: enc.ciphertext,
          password_nonce: enc.nonce,
          run_index: row.runIndex,
          skin: row.skin,
          country: row.country,
          lang: row.lang,
          currency: row.currency,
          status: "pending",
        },
        { onConflict: "tenant_id,email" },
      );
  } catch (e) {
    console.error("[kylo-signup] teszt fiók mentése sikertelen:", e);
  }
}

type SignupState = {
  run_counter: number;
  last_proxy_id: string | null;
  last_skin: string | null;
};

function readState(spec: unknown): SignupState {
  const s = (spec as Record<string, unknown> | null) ?? {};
  const raw = (s.kylo_signup as Partial<SignupState> | undefined) ?? {};
  return {
    run_counter: typeof raw.run_counter === "number" ? raw.run_counter : 0,
    last_proxy_id: typeof raw.last_proxy_id === "string" ? raw.last_proxy_id : null,
    last_skin: typeof raw.last_skin === "string" ? raw.last_skin : null,
  };
}

// ─────────────────────────────────────────────────────────────
// startKyloSignupRun — új futás sorba tétele
// ─────────────────────────────────────────────────────────────

const StartInput = z.object({
  baseUrl: z.string().url().default("https://kylo.study"),
  // Ha a UI-ból konkrét proxy jön, azt használjuk; egyébként rotálunk.
  proxyId: z.string().uuid().nullable().optional(),
  // Kényszerített skin (opcionális). Alapból a rotáció dönt.
  forceSkin: z.enum(["puppy-cat", "alaszka"]).nullable().optional(),
});

export const startKyloSignupRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Tenant
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
    const tenantId = prof.tenant_id;

    // Workflow: 1 db per tenant
    let wf = await supabase
      .from("workflows")
      .select("id, spec")
      .eq("tenant_id", tenantId)
      .eq("module", "audit")
      .contains("spec", { monitor_type: SIGNUP_MONITOR })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let wfId: string;
    let currentSpec: Record<string, unknown>;
    if (wf.data?.id) {
      wfId = wf.data.id;
      currentSpec = (wf.data.spec as Record<string, unknown> | null) ?? {};
    } else {
      const { data: created, error: wfErr } = await supabase
        .from("workflows")
        .insert({
          tenant_id: tenantId,
          module: "audit",
          name: "Kylo Sign Up",
          spec: {
            monitor_type: SIGNUP_MONITOR,
            kylo_signup: { run_counter: 0, last_proxy_id: null, last_skin: null },
          } as never,
        })
        .select("id, spec")
        .single();
      if (wfErr || !created) throw new Error(wfErr?.message || "workflow insert failed");
      wfId = created.id;
      currentSpec = (created.spec as Record<string, unknown> | null) ?? {};
    }

    const state = readState(currentSpec);
    const nextCounter = state.run_counter + 1;

    // Skin rotáció: puppy-cat / alaszka váltogatva. forceSkin felülírja.
    const rotatedSkin = SKIN_ORDER[nextCounter % SKIN_ORDER.length];
    const skin = data.forceSkin ?? rotatedSkin;

    // Proxy választás
    let proxyId = data.proxyId ?? null;
    let expectedCountry: string | null = null;
    if (!proxyId) {
      const { data: activeProxies } = await supabase
        .from("proxies")
        .select("id, country, label")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("label", { ascending: true });
      const list = activeProxies ?? [];
      if (list.length === 0) throw new Error("Nincs aktív proxy — vegyél fel legalább egyet a Proxies oldalon.");
      const languageSafeList = list.filter((p) =>
        ENGLISH_SIGNUP_COUNTRIES.has(((p.country as string | null) || "").toUpperCase()),
      );
      const rotationList = languageSafeList.length > 0 ? languageSafeList : list;
      // Kerüljük a legutóbbit, ha van több választás.
      const pool = rotationList.length > 1 && state.last_proxy_id
        ? rotationList.filter((p) => p.id !== state.last_proxy_id)
        : rotationList;
      const chosen = pool[nextCounter % pool.length];
      proxyId = chosen.id;
      expectedCountry = (chosen.country || "").toUpperCase() || null;
    } else {
      const { data: p } = await supabase
        .from("proxies")
        .select("country")
        .eq("id", proxyId)
        .maybeSingle();
      expectedCountry = ((p?.country as string | null) || "").toUpperCase() || null;
    }

    // A futás nyelve a proxy országából jön (pl. FR → fr-FR, JP → ja).
    const lang = langForCountry(expectedCountry);
    const currency = currencyForCountry(expectedCountry);
    const email = aliasFor(nextCounter);
    const password = generatePassword();

    const recordedActions = Array.isArray(currentSpec.recorded_actions)
      ? currentSpec.recorded_actions
      : [];

    const spec = {
      ...currentSpec,
      monitor_type: SIGNUP_MONITOR,
      account_label: `Kylo Sign Up #${nextCounter} · ${(expectedCountry ?? "??")} · ${skin}`,
      // A felvett lépések útmutatóként mennek — a signup script követi az
      // eredeti regisztrációs űrlapot, de friss aliasszal regisztrál.
      ...(recordedActions.length > 0
        ? { recorded_actions: recordedActions, brain_task: null }
        : {}),
      kylo_signup: {
        base_url: data.baseUrl,
        run_index: nextCounter,
        skin,
        lang,
        currency,
        expected_country: expectedCountry,
        email,
        password,
      },
    };

    // Queue: brain_workflow_runs (a worker ezt claimolja proxy_id alapján).
    const { data: run, error: qErr } = await supabase
      .from("brain_workflow_runs")
      .insert({
        workflow_id: wfId,
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
            message: `Sign Up #${nextCounter} sorba téve — skin=${skin}, ország=${expectedCountry ?? "?"}, nyelv=${lang}, alias=${email}`,
          },
        ] as never,
      })
      .select("id")
      .single();
    if (qErr) throw new Error(qErr.message);

    await saveTestAccount(supabase as never, {
      tenantId,
      workflowId: wfId,
      runId: run!.id,
      email,
      password,
      runIndex: nextCounter,
      skin,
      country: expectedCountry,
      lang,
      currency,
    });



    // Rotáció állapot mentése
    const nextState: SignupState = {
      run_counter: nextCounter,
      last_proxy_id: proxyId,
      last_skin: skin,
    };
    const updatedSpec = {
      ...currentSpec,
      monitor_type: SIGNUP_MONITOR,
      kylo_signup: nextState,
    };
    await supabase
      .from("workflows")
      .update({ spec: updatedSpec as never })
      .eq("id", wfId);

    return {
      runId: run!.id,
      workflowId: wfId,
      runIndex: nextCounter,
      skin,
      lang,
      currency,
      email,
      country: expectedCountry,
    };
  });

// ─────────────────────────────────────────────────────────────
// startAllEnglishSignupRuns — terheléses teszt:
// minden aktív angol nyelvterületi proxyra egyszerre sorba tesz 1 futást.
// ─────────────────────────────────────────────────────────────

export const startAllEnglishSignupRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        baseUrl: z.string().url().default("https://kylo.study"),
        scope: z.enum(["english", "non-english", "all"]).default("english"),
        // Időzített indítás: a futás sorba kerül, de a worker csak ezután veszi fel.
        notBefore: z.string().datetime().nullable().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
    const tenantId = prof.tenant_id;

    const { data: wfRow } = await supabase
      .from("workflows")
      .select("id, spec")
      .eq("tenant_id", tenantId)
      .eq("module", "audit")
      .contains("spec", { monitor_type: SIGNUP_MONITOR })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!wfRow?.id) throw new Error("Nincs Kylo Sign Up workflow — nyisd meg előbb az oldalt.");
    const wfId = wfRow.id;
    const currentSpec = (wfRow.spec as Record<string, unknown> | null) ?? {};

    const { data: activeProxies } = await supabase
      .from("proxies")
      .select("id, country, label")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("label", { ascending: true });
    const english = (activeProxies ?? []).filter((p) => {
      const cc = ((p.country as string | null) || "").toUpperCase();
      const isEnglish = ENGLISH_SIGNUP_COUNTRIES.has(cc);
      if (data.scope === "english") return isEnglish;
      if (data.scope === "non-english") return !isEnglish && !!cc;
      return !!cc;
    });
    if (english.length === 0) {
      throw new Error(
        data.scope === "non-english"
          ? "Nincs aktív nem-angol nyelvterületi proxy."
          : "Nincs aktív angol nyelvterületi proxy (US/GB/CA/AU/NZ/IE).",
      );
    }

    const { count: activeCount, error: activeErr } = await supabase
      .from("brain_workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", wfId)
      .in("status", ["queued", "scheduled", "running"]);
    if (activeErr) throw new Error(activeErr.message);
    if ((activeCount ?? 0) > 0) {
      throw new Error(
        "Már van futó vagy időzített Kylo Sign Up kör. Előbb várjuk meg, amíg kifut, különben túlterheljük a rendszert.",
      );
    }

    const state = readState(currentSpec);
    const recordedActions = Array.isArray(currentSpec.recorded_actions)
      ? currentSpec.recorded_actions
      : [];

    const queued: Array<{ runId: string; runIndex: number; country: string | null; skin: string; email: string }> = [];
    let counter = state.run_counter;
    let lastSkin = state.last_skin;

    const baseNotBeforeMs = data.notBefore ? Date.parse(data.notBefore) : null;

    for (const [index, p] of english.entries()) {
      counter += 1;
      const skin = SKIN_ORDER[counter % SKIN_ORDER.length];
      const expectedCountry = ((p.country as string | null) || "").toUpperCase() || null;
      const lang = langForCountry(expectedCountry);
      const currency = currencyForCountry(expectedCountry);
      const email = aliasFor(counter);
      const password = generatePassword();

      const spec = {
        ...currentSpec,
        monitor_type: SIGNUP_MONITOR,
        account_label: `Kylo Sign Up #${counter} · ${expectedCountry ?? "??"} · ${skin}`,
        // A felvett lépések útmutatóként mennek — a signup script követi az
        // eredeti regisztrációs űrlapot, de friss aliasszal regisztrál.
        ...(recordedActions.length > 0 ? { recorded_actions: recordedActions, brain_task: null } : {}),
        kylo_signup: {
          base_url: data.baseUrl,
          run_index: counter,
          skin,
          lang,
          currency,
          expected_country: expectedCountry,
          email,
          password,
        },
      };

      const notBefore =
        baseNotBeforeMs && Number.isFinite(baseNotBeforeMs)
          ? new Date(baseNotBeforeMs + index * 10 * 60 * 1000).toISOString()
          : null;
      const { data: run, error: qErr } = await supabase
        .from("brain_workflow_runs")
        .insert({
          workflow_id: wfId,
          tenant_id: tenantId,
          module: "audit",
          runner: "docker",
          status: (notBefore ? "scheduled" : "queued") as never,
          proxy_id: p.id,
          spec_snapshot: spec as never,
          not_before: notBefore,
          started_at: notBefore ? null : new Date().toISOString(),
          logs: [
            {
              ts: new Date().toISOString(),
              level: "info",
              message: notBefore
                ? `Időzítve — Sign Up #${counter} indul ${new Date(notBefore).toLocaleString("hu-HU")} után (proxy: ${p.label ?? expectedCountry}, skin=${skin}, alias=${email})`
                : `Terheléses teszt — Sign Up #${counter} sorba téve (proxy: ${p.label ?? expectedCountry}, skin=${skin}, alias=${email})`,
            },
          ] as never,
        })
        .select("id")
        .single();
      if (qErr) throw new Error(qErr.message);

      await saveTestAccount(supabase as never, {
        tenantId,
        workflowId: wfId,
        runId: run!.id,
        email,
        password,
        runIndex: counter,
        skin,
        country: expectedCountry,
        lang,
        currency,
      });



      lastSkin = skin;
      queued.push({ runId: run!.id, runIndex: counter, country: expectedCountry, skin, email });
    }

    await supabase
      .from("workflows")
      .update({
        spec: {
          ...currentSpec,
          monitor_type: SIGNUP_MONITOR,
          kylo_signup: {
            run_counter: counter,
            last_proxy_id: english[english.length - 1].id,
            last_skin: lastSkin,
          },
        } as never,
      })
      .eq("id", wfId);

    return { queued, count: queued.length };
  });

// ─────────────────────────────────────────────────────────────
// ensureKyloSignupWorkflow — a workflow eleve létrejön,
// hogy a Hitelesítő adatok / Gmail beköthető legyen még az első futás előtt.
// ─────────────────────────────────────────────────────────────

export const ensureKyloSignupWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant a profilhoz.");
    const tenantId = prof.tenant_id;

    const existing = await supabase
      .from("workflows")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("module", "audit")
      .contains("spec", { monitor_type: SIGNUP_MONITOR })
      .maybeSingle();
    if (existing.data?.id) return { workflowId: existing.data.id };

    const { data: created, error } = await supabase
      .from("workflows")
      .insert({
        tenant_id: tenantId,
        module: "audit",
        name: "Kylo Sign Up",
        spec: {
          monitor_type: SIGNUP_MONITOR,
          kylo_signup: { run_counter: 0, last_proxy_id: null, last_skin: null },
        } as never,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { workflowId: created!.id };
  });

// ─────────────────────────────────────────────────────────────
// listKyloSignupRuns — az utóbbi 50 futás + Gmail státusz
// ─────────────────────────────────────────────────────────────

export const listKyloSignupRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) return { workflow: null, runs: [] as never[], gmail: null };
    const tenantId = prof.tenant_id;

    const { data: wf } = await supabase
      .from("workflows")
      .select("id, name, spec")
      .eq("tenant_id", tenantId)
      .eq("module", "audit")
      .contains("spec", { monitor_type: SIGNUP_MONITOR })
      .maybeSingle();

    if (!wf?.id) return { workflow: null, runs: [] as never[], gmail: null };

    const [runsRes, credRes, proxyCredRes] = await Promise.all([
      supabase
        .from("brain_workflow_runs")
        // csak a JSON-részleteket kérjük le, nem a teljes spec_snapshot/result
        // oszlopot (azokban több MB-nyi felvett lépés és base64 kép van)
        .select(
          "id, status, started_at, finished_at, error, proxy_id, " +
            "kylo_signup:spec_snapshot->kylo_signup, " +
            "reached_stripe:result->reached_stripe, final_url:result->>final_url, " +
            "language_ok:result->language_ok, expected_lang:result->>expected_lang",
        )
        .eq("workflow_id", wf.id)
        .order("started_at", { ascending: false })
        .limit(50),

      supabase
        .from("workflow_credentials")
        .select("gmail_email, gmail_connected_at")
        .eq("workflow_id", wf.id)
        .eq("platform", "gmail")
        .maybeSingle(),
      supabase
        .from("workflow_credentials")
        .select("proxy_id")
        .eq("workflow_id", wf.id)
        .eq("platform", "recorder")
        .maybeSingle(),
    ]);

    // FONTOS: a lista könnyű maradjon. A spec_snapshot tartalmazza a teljes
    // felvett kattintássort, a result pedig a base64 képernyőképeket — 50
    // futásnál ez több MB-os választ adna, amitől a panel üresen maradt.
    type SignupMeta = {
      skin?: string;
      lang?: string;
      currency?: string;
      email?: string;
      expected_country?: string | null;
      run_index?: number;
    };
    type SlimResult = {
      reached_stripe?: boolean;
      final_url?: string;
      language_ok?: boolean;
      expected_lang?: string;
      steps?: unknown[];
      screenshots?: unknown[];
    };
    const slimRun = (r: Record<string, unknown>) => ({
      id: r.id as string,
      status: r.status as string,
      started_at: (r.started_at ?? null) as string | null,
      finished_at: (r.finished_at ?? null) as string | null,
      error: (r.error ?? null) as string | null,
      proxy_id: (r.proxy_id ?? null) as string | null,
      spec_snapshot: { kylo_signup: (r.kylo_signup ?? null) as SignupMeta | null },
      result: {
        reached_stripe: (r.reached_stripe ?? null) as boolean | null,
        final_url: (r.final_url ?? null) as string | null,
        language_ok: (r.language_ok ?? null) as boolean | null,
        expected_lang: (r.expected_lang ?? null) as string | null,
      },
    });


    const rawSpec = (wf.spec ?? {}) as {
      monitor_type?: string;
      kylo_signup?: { run_counter?: number; last_skin?: string; last_proxy_id?: string };
      recorded_actions?: unknown[];
    };
    const wfSpec = {
      monitor_type: rawSpec.monitor_type ?? null,
      kylo_signup: rawSpec.kylo_signup ?? null,
      recorded_actions_count: Array.isArray(rawSpec.recorded_actions) ? rawSpec.recorded_actions.length : 0,
    };

    if (runsRes.error) throw new Error(`runs: ${runsRes.error.message}`);

    return {
      workflow: { id: wf.id as string, name: wf.name as string, spec: wfSpec },


      runs: ((runsRes.data ?? []) as unknown as Record<string, unknown>[]).map(slimRun),
      gmail: credRes.data?.gmail_email
        ? { email: credRes.data.gmail_email as string, connectedAt: credRes.data.gmail_connected_at }
        : null,
      recorderProxyId: (proxyCredRes.data as { proxy_id?: string | null } | null)?.proxy_id ?? null,
    };
  });

// ─────────────────────────────────────────────────────────────
// getKyloSignupRun — egyetlen futás TELJES adata (képernyőképek,
// lépések, nyelvi ellenőrzés) — csak a részletek ablak nyitásakor.
// ─────────────────────────────────────────────────────────────

export const getKyloSignupRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: run, error } = await supabase
      .from("brain_workflow_runs")
      .select("id, status, started_at, finished_at, spec_snapshot, result, error, proxy_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { run: run ?? null };
  });


// ─────────────────────────────────────────────────────────────
// setKyloSignupRecorderProxy — a Felvétel / Live Browse gombhoz
// külön eltárolt proxy a workflow_credentials (platform="recorder") sorban.
// A record-claim végpont az első proxy_id-vel rendelkező cred sort veszi.
// ─────────────────────────────────────────────────────────────

export const setKyloSignupRecorderProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        proxyId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.proxyId === null) {
      const { error } = await supabase
        .from("workflow_credentials")
        .delete()
        .eq("workflow_id", data.workflowId)
        .eq("platform", "recorder");
      if (error) throw new Error(error.message);
      return { ok: true, proxyId: null as string | null };
    }
    const url = await loadProxyUrlServer(data.proxyId, supabase as never);
    if (!url) throw new Error("A kiválasztott proxy nem található.");
    const { ciphertext, nonce } = await encryptString(url);
    const { error } = await supabase
      .from("workflow_credentials")
      .upsert(
        {
          workflow_id: data.workflowId,
          platform: "recorder",
          proxy_id: data.proxyId,
          proxy_ciphertext: ciphertext,
          proxy_nonce: nonce,
        } as never,
        { onConflict: "workflow_id,platform" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, proxyId: data.proxyId };
  });

// ─────────────────────────────────────────────────────────────
// deleteKyloSignupRun — egyetlen futás törlése a listából.
// Csak a saját tenant futásait engedjük törölni; RLS is véd, de
// itt explicit is ellenőrizzük a workflow → tenant kapcsolatot.
// ─────────────────────────────────────────────────────────────

export const deleteKyloSignupRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant.");
    const { error } = await supabase
      .from("brain_workflow_runs")
      .delete()
      .eq("id", data.runId)
      .eq("tenant_id", prof.tenant_id);
    if (error) throw new Error(error.message);

    // A képek a Hetzner puffer szolgáltatásban vannak — azokat is töröljük.
    const shotsUrl = (process.env.SHOTS_UPLOAD_URL || "").replace(/\/$/, "");
    const token = (process.env.WORKER_API_TOKEN || "").trim();
    let shotsDeleted = false;
    if (shotsUrl && token) {
      try {
        const res = await fetch(`${shotsUrl}/run/${data.runId}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        });
        shotsDeleted = res.ok;
      } catch {
        shotsDeleted = false;
      }
    }
    return { ok: true, shotsDeleted };
  });




// ─────────────────────────────────────────────────────────────
// cancelPendingSignupRuns — az összes még el nem indult (queued /
// scheduled) futás visszavonása egy kattintással. Ez a "vészfék",
// ha véletlenül túl sok futás került egyszerre a sorba.
// ─────────────────────────────────────────────────────────────

export const cancelPendingSignupRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant.");

    const { data: rows, error } = await supabase
      .from("brain_workflow_runs")
      .update({
        status: "failed" as never,
        finished_at: new Date().toISOString(),
        error: "kézi leállítás: sorban álló futás visszavonva (túlterhelés elkerülése)",
      } as never)
      .eq("tenant_id", prof.tenant_id)
      .in("status", ["queued", "scheduled"])
      .select("id");
    if (error) throw new Error(error.message);
    return { ok: true, canceled: rows?.length ?? 0 };
  });


// ─────────────────────────────────────────────────────────────
// deleteKyloSignupRuns — több futás törlése egyszerre (kijelölés
// alapján). A Hetzner képpufferből is töröljük a képeket.
// ─────────────────────────────────────────────────────────────

export const deleteKyloSignupRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ runIds: z.array(z.string().uuid()).min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) throw new Error("Nincs tenant.");

    const { data: rows, error } = await supabase
      .from("brain_workflow_runs")
      .delete()
      .in("id", data.runIds)
      .eq("tenant_id", prof.tenant_id)
      .select("id");
    if (error) throw new Error(error.message);

    const shotsUrl = (process.env.SHOTS_UPLOAD_URL || "").replace(/\/$/, "");
    const token = (process.env.WORKER_API_TOKEN || "").trim();
    if (shotsUrl && token) {
      await Promise.all(
        data.runIds.map((id) =>
          fetch(`${shotsUrl}/run/${id}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          }).catch(() => null),
        ),
      );
    }
    return { ok: true, deleted: rows?.length ?? 0 };
  });

// ─────────────────────────────────────────────────────────────
// getKyloSignupSummary — összkép az ÖSSZES eddigi futásról:
// státuszok, hibaokok kategóriánként, nyelvenkénti fordítás-állapot.
// ─────────────────────────────────────────────────────────────

function classifyError(err: string | null): string {
  const e = (err ?? "").toLowerCase();
  if (!e) return "ismeretlen";
  if (e.includes("watchdog")) return "beragadt futás (worker nem jelentkezett)";
  if (e.includes("kézi leállítás")) return "kézzel visszavonva (sorban állt)";
  if (e.includes("nem sikerült kiolvasni az országot")) return "proxy/ország ellenőrzés bukott";
  if (e.includes("timeout")) return "időtúllépés (lassú oldal / proxy)";
  if (e.includes("proxy")) return "proxy hiba";
  if (e.includes("nyelv")) return "nyelvi ellenőrzés bukott";
  return "egyéb";
}

export const getKyloSignupSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!prof?.tenant_id) return null;

    const { data: wf } = await supabase
      .from("workflows")
      .select("id")
      .eq("tenant_id", prof.tenant_id)
      .eq("module", "audit")
      .contains("spec", { monitor_type: SIGNUP_MONITOR })
      .maybeSingle();
    if (!wf?.id) return null;

    const { data, error } = await supabase
      .from("brain_workflow_runs")
      .select(
        "id, status, error, " +
          "language_ok:result->language_ok, expected_lang:result->>expected_lang, " +
          "logged_in:result->logged_in, final_url:result->>final_url, " +
          "reached_stripe:result->reached_stripe, reached_profile:result->reached_profile, " +
          "shots:result->screenshots_count, acts:result->replay_action_count",
      )
      .eq("workflow_id", wf.id)
      .limit(1000);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Array<{
      status: string;
      error: string | null;
      language_ok: boolean | null;
      expected_lang: string | null;
      logged_in: boolean | null;
      final_url: string | null;
      reached_stripe: boolean | null;
      reached_profile: boolean | null;
      shots: number | null;
      acts: number | null;
    }>;

    const byStatus: Record<string, number> = {};
    const byError: Record<string, number> = {};
    const byLang: Record<string, { total: number; ok: number; bad: number }> = {};
    let loggedIn = 0;
    let reachedStripe = 0;
    let reachedProfile = 0;
    let actsSum = 0;
    let actsCount = 0;

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.status === "failed") {
        const k = classifyError(r.error);
        byError[k] = (byError[k] ?? 0) + 1;
      }
      if (r.reached_stripe === true) reachedStripe += 1;
      if (r.reached_profile === true) reachedProfile += 1;
      if (r.status === "succeeded") {
        if (r.logged_in) loggedIn += 1;
        if (typeof r.acts === "number") {
          actsSum += r.acts;
          actsCount += 1;
        }
        const lang = r.expected_lang ?? "ismeretlen";
        const b = (byLang[lang] ??= { total: 0, ok: 0, bad: 0 });
        b.total += 1;
        if (r.language_ok === true) b.ok += 1;
        else b.bad += 1;
      }
    }

    return {
      total: rows.length,
      byStatus,
      byError,
      byLang,
      loggedIn,
      reachedStripe,
      reachedProfile,
      avgActions: actsCount ? Math.round(actsSum / actsCount) : null,
    };

  });

// ─────────────────────────────────────────────────────────────
// Teszt fiókok (alias e-mail + jelszó) — mentés, listázás, jelszó előhívás.
// A későbbi funkcionális teszteknél már ezekkel lépünk be, nem regisztrálunk újra.
// ─────────────────────────────────────────────────────────────

export const listKyloTestAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("audit_test_accounts")
      .select(
        "id, email, run_index, skin, country, lang, currency, status, registered_at, last_login_at, created_at, notes",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return { accounts: data ?? [] };
  });

export const revealKyloTestPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("audit_test_accounts")
      .select("id, email, password_ciphertext, password_nonce")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Nincs ilyen teszt fiók.");
    const { decryptString } = await import("@/lib/credentials/crypto.server");
    const password = await decryptString(
      row.password_ciphertext as string,
      row.password_nonce as string,
    );
    return { email: row.email as string, password };
  });

export const markKyloTestAccountLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("audit_test_accounts")
      .update({ last_login_at: new Date().toISOString() } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteKyloTestAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("audit_test_accounts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
