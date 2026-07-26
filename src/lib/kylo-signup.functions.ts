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
      ...(recordedActions.length > 0
        ? {
            brain_task: {
              task_type: "record_replay_login",
              platform: "kylo-study",
            },
            recorded_actions: recordedActions,
          }
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

    const state = readState(currentSpec);
    const recordedActions = Array.isArray(currentSpec.recorded_actions)
      ? currentSpec.recorded_actions
      : [];

    const queued: Array<{ runId: string; runIndex: number; country: string | null; skin: string; email: string }> = [];
    let counter = state.run_counter;
    let lastSkin = state.last_skin;

    for (const p of english) {
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
        ...(recordedActions.length > 0
          ? {
              brain_task: { task_type: "record_replay_login", platform: "kylo-study" },
              recorded_actions: recordedActions,
            }
          : {}),
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

      const { data: run, error: qErr } = await supabase
        .from("brain_workflow_runs")
        .insert({
          workflow_id: wfId,
          tenant_id: tenantId,
          module: "audit",
          runner: "docker",
          status: "queued",
          proxy_id: p.id,
          spec_snapshot: spec as never,
          started_at: new Date().toISOString(),
          logs: [
            {
              ts: new Date().toISOString(),
              level: "info",
              message: `Terheléses teszt — Sign Up #${counter} sorba téve (proxy: ${p.label ?? expectedCountry}, skin=${skin}, alias=${email})`,
            },
          ] as never,
        })
        .select("id")
        .single();
      if (qErr) throw new Error(qErr.message);

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
        .select("id, status, started_at, finished_at, spec_snapshot, result, error, proxy_id")
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
    type SlimResult = Record<string, unknown>;
    const slimRun = (r: Record<string, unknown>) => {
      const snap = (r.spec_snapshot ?? {}) as Record<string, unknown>;
      const res = (r.result ?? null) as SlimResult | null;
      return {
        id: r.id as string,
        status: r.status as string,
        started_at: (r.started_at ?? null) as string | null,
        finished_at: (r.finished_at ?? null) as string | null,
        error: (r.error ?? null) as string | null,
        proxy_id: (r.proxy_id ?? null) as string | null,
        spec_snapshot: { kylo_signup: snap.kylo_signup ?? null },
        result: res
          ? {
              reached_stripe: res.reached_stripe,
              final_url: res.final_url,
              language_ok: res.language_ok,
              expected_lang: res.expected_lang,
              steps_count: Array.isArray(res.steps) ? res.steps.length : 0,
              screenshots_count: Array.isArray(res.screenshots) ? res.screenshots.length : 0,
            }
          : null,
      };
    };

    const wfSpec = { ...((wf.spec ?? {}) as Record<string, unknown>) };
    const recCount = Array.isArray(wfSpec.recorded_actions) ? wfSpec.recorded_actions.length : 0;
    delete wfSpec.recorded_actions;
    (wfSpec as Record<string, unknown>).recorded_actions_count = recCount;

    return {
      workflow: { id: wf.id, name: wf.name, spec: wfSpec },
      runs: ((runsRes.data ?? []) as Record<string, unknown>[]).map(slimRun),
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
    return { ok: true };
  });



