// Worker run completion endpoint — a VPS worker hívja, amikor a futás befejeződött
// (sikeres, hibára futott, vagy megszakadt). A logokat és a végeredményt írja vissza.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  INFRA_STATUS,
  classifyInfraError,
  infraLabel,
} from "@/lib/infra-errors";

// Infra-hiba után egyszer újrapróbáljuk a futást egy másik proxyval.
// Ugyanazt a spec-et visszatesszük a sorba, csak más proxyval és egy
// „infra_attempt" számlálóval, hogy ne pörögjön végtelenre.
async function requeueWithAnotherProxy(
  sb: ReturnType<typeof createClient<Database>>,
  input: {
    runId: string;
    tenantId: string | null;
    workflowId: string | null;
    proxyId: string | null;
    spec: Record<string, unknown>;
    infraCode: string | null;
  },
): Promise<void> {
  const { tenantId, workflowId, spec } = input;
  if (!tenantId || !workflowId) return;

  const attempt = Number((spec as { infra_attempt?: unknown }).infra_attempt ?? 0);
  if (attempt >= 1) return; // legfeljebb egy automatikus újrapróbálás

  const signup = (spec as { kylo_signup?: { expected_country?: string | null } }).kylo_signup;
  const wantedCountry = (signup?.expected_country ?? "").toUpperCase() || null;
  const nowIso = new Date().toISOString();

  const { data: proxies } = await sb
    .from("proxies")
    .select("id, country, label, health_paused_until")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  const pool = (proxies ?? []).filter((p) => {
    const paused = (p as { health_paused_until?: string | null }).health_paused_until;
    if (paused && paused > nowIso) return false;
    return p.id !== input.proxyId;
  });
  if (pool.length === 0) return;
  const sameCountry = wantedCountry
    ? pool.filter((p) => ((p.country as string | null) ?? "").toUpperCase() === wantedCountry)
    : [];
  const chosen = (sameCountry.length > 0 ? sameCountry : pool)[
    Math.floor(Math.random() * (sameCountry.length > 0 ? sameCountry.length : pool.length))
  ];

  const retrySpec = {
    ...spec,
    infra_attempt: attempt + 1,
    infra_retry_of: input.runId,
  };

  await sb.from("brain_workflow_runs").insert({
    workflow_id: workflowId,
    tenant_id: tenantId,
    module: "audit",
    runner: "docker",
    status: "queued",
    proxy_id: chosen.id,
    spec_snapshot: retrySpec as never,
    started_at: new Date().toISOString(),
    logs: [
      {
        ts: new Date().toISOString(),
        level: "warn",
        message: `Proxy hiba (${infraLabel(input.infraCode)}) — automatikus újrapróbálás másik proxyval: ${
          (chosen as { label?: string | null }).label ?? chosen.country ?? chosen.id
        }`,
      },
    ] as never,
  } as never);
}


function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? request.headers.get("x-api-key") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  runId: z.string().uuid(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  logs: z
    .array(
      z.object({
        ts: z.string(),
        level: z.enum(["info", "warn", "error"]),
        message: z.string(),
      }),
    )
    .default([]),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  preflight: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const Route = createFileRoute("/api/public/worker/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "bad request" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const { data: runMeta } = await sb
          .from("brain_workflow_runs")
          .select("spec_snapshot")
          .eq("id", parsed.runId)
          .maybeSingle();
        const specSnapshot = (runMeta?.spec_snapshot ?? {}) as Record<string, unknown>;
        const specIsScenario =
          specSnapshot.monitor_type === "kylo-scenario" ||
          (specSnapshot.kylo_scenario !== null &&
            typeof specSnapshot.kylo_scenario === "object");

        // A cookies_export nagy blob (akár több száz KB) — a brain_workflow_runs.result-ba
        // csak a slim változatot mentjük; a valódi süti-tár titkosítva megy a
        // workflow_credentials-be lentebb.
        const slimResult =
          parsed.result && typeof parsed.result === "object"
            ? Object.fromEntries(
                Object.entries(parsed.result).filter(([k]) => k !== "cookies_export"),
              )
            : parsed.result ?? null;

        // Méret-védelem: a base64 screenshotok együtt több MB-ot is kitehetnek,
        // amitől a DB update elhasalt (500) és a futás „running"-ban ragadt.
        // Csak annyi képet tartunk meg, ami biztosan belefér, a többit levágjuk.
        const MAX_SHOTS_BYTES = 1_500_000;
        if (slimResult && typeof slimResult === "object") {
          const shots = (slimResult as { screenshots?: unknown }).screenshots;
          if (Array.isArray(shots)) {
            let used = 0;
            let dropped = 0;
            const kept = shots.map((shot) => {
              if (!shot || typeof shot !== "object") return shot;
              const s = shot as { b64?: unknown };
              const size = typeof s.b64 === "string" ? s.b64.length : 0;
              if (size && used + size > MAX_SHOTS_BYTES) {
                dropped += 1;
                const { b64: _omit, ...rest } = s as Record<string, unknown>;
                return { ...rest, b64_omitted: true };
              }
              used += size;
              return shot;
            });
            (slimResult as Record<string, unknown>).screenshots = kept;
            if (dropped > 0) {
              (slimResult as Record<string, unknown>).screenshots_dropped_for_size = dropped;
            }
          }
        }

        // A logokat is korlátozzuk (utolsó 600 sor, soronként max 2000 karakter).
        const trimmedLogs = parsed.logs.slice(-600).map((l) => ({
          ...l,
          message: l.message.length > 2000 ? `${l.message.slice(0, 2000)}…` : l.message,
        }));

        // Nyelvi bukás valódi hibának számít: ha a futás egyébként sikeres,
        // de az oldal nem a várt nyelven jelent meg, „failed"-re állítjuk.
        // (A kylo.study nyitóoldala szándékosan angol — azt a worker nem jelenti hibának.)
        const res = slimResult as Record<string, unknown> | null;
        const langOk = res?.language_ok;
        const expectedLang = res?.expected_lang;
        const languageFailed = parsed.status === "succeeded" && langOk === false;

        // Kylo signup: csak akkor sikeres, ha a fizetésig ÉS a profil oldalig eljutott.
        // Kylo forgatókönyv / belépés-kocka: Stripe NEM feltétel. Fontos védőháló:
        // ha a VPS-en még egy régebbi lejátszó fut, akkor a result.scenario_mode
        // hiányozhat, de a spec_snapshot-ból és a belső Kylo vég-URL-ből akkor is
        // felismerjük, hogy ez sikeres belépés-próba volt.
        const flowChecked = res?.kylo_flow_checked === true;
        const finalUrl = typeof res?.final_url === "string" ? res.final_url : "";
        const scenarioTargetReached =
          specIsScenario &&
          /kylo\.study\/(profile|profil|fiok|fiók|account|dashboard|my|settings|beallitasok|generalas|general|funkciok|funkciók|feladatok|feltoltes|feltöltés|olvasonaplo|olvasónapló|konyvtar|könyvtár|tanulas|tanulás)\b/i.test(
            finalUrl,
          );
        if (res && specIsScenario) {
          res.scenario_mode = true;
          if (scenarioTargetReached) {
            res.reached_profile = true;
            res.profile_url = finalUrl;
            res.flow_ok = true;
            res.criteria_failed = [];
          }
        }
        const isScenarioRun = res?.scenario_mode === true || specIsScenario;
        const effectiveFlowOk = isScenarioRun
          ? res?.reached_profile === true || scenarioTargetReached
          : res?.flow_ok === true;
        const scenarioLegacyFalseFailure =
          parsed.status === "failed" && scenarioTargetReached;
        const effectiveStatus = scenarioLegacyFalseFailure ? "succeeded" : parsed.status;
        const flowFailed =
          effectiveStatus === "succeeded" && flowChecked && !effectiveFlowOk;
        const criteriaFailed = Array.isArray(res?.criteria_failed)
          ? (res?.criteria_failed as string[])
          : [];
        const flowReason = criteriaFailed.length > 0
          ? `Nem teljesült kritériumok: ${criteriaFailed.join(", ")}`
          : !flowChecked
            ? ""
            : isScenarioRun
              ? `A forgatókönyv nem ért célba: belépés utáni cél oldal ${res?.reached_profile ? "IGEN" : "NEM"}`
              : `A folyamat nem ért célba: fizetés (Stripe) ${res?.reached_stripe ? "IGEN" : "NEM"}, profil oldal ${res?.reached_profile ? "IGEN" : "NEM"}`;

        // ---- Infrastruktúra- (proxy-) hiba felismerés ----
        // Ha a bukás oka a hálózat/proxy volt (kapcsolat nem épült fel, lassú
        // proxy, geo-eltérés), akkor NEM a terméket buktatjuk el: külön
        // „infra_error" státuszt kap, ami a felületen sárga „Proxy hiba".
        const workerInfraCode =
          res && res.infra_error === true
            ? typeof res.infra_code === "string"
              ? res.infra_code
              : "proxy_connection"
            : null;
        const infraCode =
          effectiveStatus === "succeeded"
            ? null
            : workerInfraCode ?? classifyInfraError(parsed.error);
        const isInfra = Boolean(infraCode) && effectiveStatus !== "succeeded";

        const failedReasons = [
          languageFailed
            ? `Nyelvi ellenőrzés bukott: nem a(z) ${expectedLang ?? "várt"} nyelv jelent meg`
            : null,
          flowFailed ? flowReason : null,
          scenarioLegacyFalseFailure ? null : parsed.error ?? null,
        ].filter(Boolean);

        if (isInfra && res) {
          res.infra_error = true;
          res.infra_code = infraCode;
          res.infra_reason = infraLabel(infraCode);
        }

        const finalStatus = isInfra
          ? INFRA_STATUS
          : languageFailed || flowFailed
            ? "failed"
            : effectiveStatus;

        const update: Record<string, unknown> = {
          status: finalStatus,
          logs: trimmedLogs as never,
          result: slimResult as never,
          error: isInfra
            ? `Infrastruktúra (proxy) hiba — ${infraLabel(infraCode)}${
                parsed.error ? `: ${parsed.error}` : ""
              }`
            : failedReasons.length > 0
              ? failedReasons.join(" — ")
              : null,
          finished_at: new Date().toISOString(),
        };

        if (parsed.preflight !== undefined) {
          update.preflight_result = parsed.preflight as never;
        }

        const { data: runRow, error } = await sb
          .from("brain_workflow_runs")
          .update(update as never)
          .eq("id", parsed.runId)
          .select("id, brain_task_id, tenant_id, workflow_id, proxy_id")
          .maybeSingle();


        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        // ---- Proxy-egészség könyvelése ----
        // Minden futás után frissítjük a proxy statisztikáját: hány hálózati
        // hibát okozott, milyen lassú. Aki sokat hibázik, pihenőre kerül és a
        // kiosztásból egy időre kimarad.
        try {
          const proxyId = (runRow as { proxy_id?: string | null } | null)?.proxy_id ?? null;
          if (proxyId) {
            const pf = (parsed.preflight ?? {}) as { latency_ms?: unknown };
            const latency =
              typeof pf.latency_ms === "number" && Number.isFinite(pf.latency_ms)
                ? Math.round(pf.latency_ms)
                : null;
            const { data: proxyRow } = await sb
              .from("proxies")
              .select("health_infra_failures, health_success_count, health_avg_latency_ms")
              .eq("id", proxyId)
              .maybeSingle();
            const prev = (proxyRow ?? {}) as {
              health_infra_failures?: number | null;
              health_success_count?: number | null;
              health_avg_latency_ms?: number | null;
            };
            const failures = isInfra ? (prev.health_infra_failures ?? 0) + 1 : 0;
            const avg =
              latency === null
                ? (prev.health_avg_latency_ms ?? null)
                : prev.health_avg_latency_ms
                  ? Math.round(prev.health_avg_latency_ms * 0.7 + latency * 0.3)
                  : latency;
            const patch: Record<string, unknown> = {
              health_infra_failures: failures,
              health_avg_latency_ms: avg,
            };
            if (isInfra) {
              patch.health_last_infra_at = new Date().toISOString();
              patch.health_last_infra_code = infraCode;
              // 3 egymást követő hálózati hiba után 2 óra pihenő.
              if (failures >= 3) {
                patch.health_paused_until = new Date(
                  Date.now() + 2 * 60 * 60 * 1000,
                ).toISOString();
              }
            } else {
              patch.health_success_count = (prev.health_success_count ?? 0) + 1;
              patch.health_paused_until = null;
            }
            await sb.from("proxies").update(patch as never).eq("id", proxyId);
          }
        } catch (e) {
          console.error("[complete] proxy-egészség frissítése sikertelen:", e);
        }

        // ---- Automatikus újrapróbálás másik proxyval ----
        // Infra-hiba esetén egyszer újrapróbáljuk a futást egy másik, azonos
        // országú (ha nincs, bármely aktív) proxyval. Csak ha az is elbukik,
        // marad hibás a kör.
        if (isInfra) {
          try {
            await requeueWithAnotherProxy(sb, {
              runId: parsed.runId,
              tenantId: (runRow as { tenant_id?: string | null } | null)?.tenant_id ?? null,
              workflowId: (runRow as { workflow_id?: string | null } | null)?.workflow_id ?? null,
              proxyId: (runRow as { proxy_id?: string | null } | null)?.proxy_id ?? null,
              spec: specSnapshot,
              infraCode,
            });
          } catch (e) {
            console.error("[complete] infra újrapróbálás sikertelen:", e);
          }
        }

        // ---- Telegram visszaigazolás a kiküldött posztokról ----
        // Minden Tartalom Stúdióból indított poszt (Reddit / LinkedIn / stb.)
        // után azonnal jön értesítés, hogy sikerült-e. Így sosem marad néma
        // a rendszer, és tudjuk, hogy él a Telegram-csatorna.
        try {
          const bt =
            specSnapshot.brain_task && typeof specSnapshot.brain_task === "object"
              ? (specSnapshot.brain_task as Record<string, unknown>)
              : null;
          const draftId = bt && typeof bt.draft_id === "string" ? bt.draft_id : null;
          if (draftId) {
            const platform = String(bt?.platform ?? specSnapshot.platform ?? "ismeretlen");
            const icon =
              platform === "reddit" ? "🟠" : platform === "linkedin" ? "🔵" : "⚪";
            const title = typeof bt?.title === "string" ? bt.title : "";
            const target = typeof bt?.target_ref === "string" ? bt.target_ref : "";
            const ok = finalStatus === "succeeded";
            const url =
              res && typeof (res as { final_url?: unknown }).final_url === "string"
                ? ((res as { final_url: string }).final_url)
                : "";
            const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");
            await sendTelegram(
              [
                `${icon} ${platform.toUpperCase()}${target ? ` · ${target}` : ""}`,
                ok ? "✅ A poszt KIMENT." : `❌ A poszt NEM ment ki (${finalStatus}).`,
                title ? `Cím: ${title}` : "",
                url ? `Link: ${url}` : "",
                update.error ? `Hiba: ${String(update.error)}` : "",
                ``,
                `↩️ Ha erre az üzenetre válaszolsz, tudni fogom, melyik posztról van szó.`,
              ]
                .filter(Boolean)
                .join("\n"),
              {
                topic: "post_result",
                platform,
                ref_table: "content_drafts",
                ref_id: draftId,
                label: `${platform}${target ? ` · ${target}` : ""}`,
                payload: { title, url, status: finalStatus },
              },
            );

          }
        } catch (e) {
          console.error("[complete] Telegram poszt-visszaigazolás sikertelen:", e);
        }

        // ---- LinkedIn metrika-pillanatkép elmentése ----
        // A metrics_snapshot futás eredményét eltesszük, és Telegramon
        // összefoglaljuk, mennyit mozdultak a posztok az előző mérés óta.
        try {
          const bt =
            specSnapshot.brain_task && typeof specSnapshot.brain_task === "object"
              ? (specSnapshot.brain_task as Record<string, unknown>)
              : null;
          const isLinkedInMetrics =
            bt?.["task_type"] === "metrics_snapshot" &&
            String(bt?.["platform"] ?? "").toLowerCase() === "linkedin" &&
            finalStatus === "succeeded";
          const snapshot = (res ?? {}) as Record<string, unknown>;
          const rawPosts = snapshot["posts"];
          if (isLinkedInMetrics && Array.isArray(rawPosts) && runRow?.tenant_id) {
            const { saveLinkedInMetrics } = await import("@/lib/linkedin-metrics.server");
            await saveLinkedInMetrics({
              tenantId: runRow.tenant_id,
              workflowId: runRow.workflow_id,
              posts: rawPosts as never,
            });
          }
        } catch (e) {
          console.error("[complete] LinkedIn metrika mentés sikertelen:", e);
        }





        // Teszt fiók állapota: ha a Sign Up futás végigment, a hozzá tartozó
        // alias e-mail + jelszó pár „regisztrált" lesz, így később belépésre
        // használható; ha bukott, jelöljük hibásnak. Infra- (proxy-) hibánál
        // nem bélyegezzük hibásnak a fiókot, mert nem rajta múlt.
        try {
          if (flowChecked && !isInfra) {
            const registered = !languageFailed && !flowFailed && effectiveStatus === "succeeded";
            await sb
              .from("audit_test_accounts")
              .update({
                status: registered ? "registered" : "failed",
                registered_at: registered ? new Date().toISOString() : null,
              } as never)
              .eq("run_id", parsed.runId);
          }
        } catch (e) {
          console.error("[complete] teszt fiók állapot frissítése sikertelen:", e);
        }


        // Warmup cookie-jar persist — ha a worker `cookies_export`-tal tért vissza,
        // titkosítva beírjuk a workflow_credentials.cookie_ciphertext mezőbe.
        // Fontos: a workflows.tenant_id-t használjuk (RLS + NOT NULL a credentials-en).
        try {
          const res = parsed.result as
            | {
                cookies_export?: unknown;
                cookies_collected?: unknown;
                cookie_domains?: unknown;
              }
            | null;
          const cookiesExport =
            res && typeof res.cookies_export === "string" ? res.cookies_export : null;
          if (parsed.status === "succeeded" && cookiesExport && runRow?.id) {
            const { data: runFull } = await sb
              .from("brain_workflow_runs")
              .select("workflow_id, tenant_id, proxy_id")
              .eq("id", parsed.runId)
              .maybeSingle();
            if (runFull?.workflow_id && runFull.tenant_id) {
              const { encryptString } = await import(
                "@/lib/credentials/crypto.server"
              );
              const { ciphertext, nonce } = await encryptString(cookiesExport);

              const { data: existing } = await sb
                .from("workflow_credentials")
                .select("id, platform, username")
                .eq("workflow_id", runFull.workflow_id)
                .maybeSingle();

              const payload = {
                tenant_id: runFull.tenant_id,
                platform: existing?.platform ?? "warmup",
                username: existing?.username ?? "warmup-jar",
                cookie_ciphertext: ciphertext,
                cookie_nonce: nonce,
                proxy_id: runFull.proxy_id,
              };
              if (existing?.id) {
                await sb
                  .from("workflow_credentials")
                  .update(payload as never)
                  .eq("id", existing.id);
              } else {
                await sb
                  .from("workflow_credentials")
                  .insert({ ...payload, workflow_id: runFull.workflow_id } as never);
              }

              // Cookie jar meta: melyik ország proxyval gyűjtöttük + statisztika.
              let proxyCountry: string | null = null;
              if (runFull.proxy_id) {
                const { data: proxyRow } = await sb
                  .from("proxies")
                  .select("country")
                  .eq("id", runFull.proxy_id)
                  .maybeSingle();
                proxyCountry =
                  proxyRow && typeof proxyRow.country === "string"
                    ? proxyRow.country
                    : null;
              }
              const cookiesCount =
                typeof res?.cookies_collected === "number"
                  ? res.cookies_collected
                  : null;
              const domainsCount = Array.isArray(res?.cookie_domains)
                ? (res.cookie_domains as unknown[]).length
                : null;

              const { data: currentWorkflow } = await sb
                .from("workflows")
                .select("cookie_jar_country, cookie_jar_locked")
                .eq("id", runFull.workflow_id)
                .maybeSingle();

              if (
                currentWorkflow?.cookie_jar_locked &&
                currentWorkflow.cookie_jar_country &&
                proxyCountry &&
                currentWorkflow.cookie_jar_country !== proxyCountry
              ) {
                console.warn(
                  `[cookie-jar] LOCK WARNING: workflow ${runFull.workflow_id} locked to ${currentWorkflow.cookie_jar_country} but run used ${proxyCountry} proxy — cookies still saved`,
                );
              }

              const workflowUpdate: Record<string, unknown> = {
                cookie_jar_updated_at: new Date().toISOString(),
                cookie_jar_stats: {
                  cookies: cookiesCount,
                  domains: domainsCount,
                },
              };
              // Csak akkor írjuk felül az országot, ha ismert.
              if (proxyCountry) {
                workflowUpdate.cookie_jar_country = proxyCountry;
              }
              await sb
                .from("workflows")
                .update(workflowUpdate as never)
                .eq("id", runFull.workflow_id);

              // Ugyanaz a proxy-ország cookie-csomag használható a hozzá kötött
              // Reddit / cél workflow-knál is. Korábban a warmup sikerült, de a
              // Reddit workflow üres maradt, ezért úgy tűnt, mintha újra és újra
              // külön Reddit warmup kellene. Itt átmásoljuk a friss süti-csomagot
              // minden ugyanarra a proxyra kötött workflow credential sorba.
              if (runFull.proxy_id) {
                const { data: siblingCreds } = await sb
                  .from("workflow_credentials")
                  .select("id, workflow_id, platform, username")
                  .eq("proxy_id", runFull.proxy_id)
                  .neq("workflow_id", runFull.workflow_id)
                  .is("cookie_ciphertext", null);

                const siblingIds = (siblingCreds ?? [])
                  .map((row) => row.workflow_id)
                  .filter(Boolean);
                const siblingCredentialIds = (siblingCreds ?? [])
                  .map((row) => row.id)
                  .filter(Boolean);

                if (siblingCredentialIds.length > 0) {
                  await sb
                    .from("workflow_credentials")
                    .update({
                      proxy_id: runFull.proxy_id,
                      cookie_ciphertext: ciphertext,
                      cookie_nonce: nonce,
                    } as never)
                    .in("id", siblingCredentialIds);
                }

                if (siblingIds.length > 0) {
                  await sb
                    .from("workflows")
                    .update(workflowUpdate as never)
                    .in("id", siblingIds);
                }
              }
            }
          }
        } catch (e) {
          console.error("warmup cookie persist error", e);
        }

        // Warmup ütemezés megújítása — ha ez egy warmup run volt (spec.is_warmup),
        // beállítjuk a következő futást ~7 nap múlvára (6-8 nap random),
        // és feloldjuk a running jelzőt a proxyn.
        try {
          const { data: runFull } = await sb
            .from("brain_workflow_runs")
            .select("proxy_id, spec_snapshot")
            .eq("id", parsed.runId)
            .maybeSingle();
          const spec = (runFull?.spec_snapshot ?? {}) as Record<string, unknown>;
          const isWarmup = spec.is_warmup === true;
          if (isWarmup && runFull?.proxy_id) {
            const succeeded = update.status === "succeeded";
            const delayMs = succeeded
              ? (6 + Math.random() * 2) * 86400 * 1000 // siker után 6-8 nap
              : (2 + Math.random() * 4) * 60 * 60 * 1000; // hiba után 2-6 óra, nem egy hét
            const next = new Date(Date.now() + delayMs);
            if (succeeded) {
              const hourJitter = 9 + Math.random() * 11; // 9-20 óra UTC-ben
              next.setUTCHours(Math.floor(hourJitter), Math.floor(Math.random() * 60), 0, 0);
            }

            await sb
              .from("proxies")
              .update({
                warmup_running_at: null,
                warmup_last_run_at: new Date().toISOString(),
                warmup_next_scheduled_at: next.toISOString(),
              })
              .eq("id", runFull.proxy_id);
          }
        } catch (e) {
          console.error("warmup reschedule error", e);
        }

        // Reddit bemelegítés naplózása: a futás eredményéből feltöltjük a napi
        // naplót, hogy a haladás (napok, subredditek, upvote-ok) látszódjon.
        try {
          if (update.status === "succeeded") {
            const { data: runFull } = await sb
              .from("brain_workflow_runs")
              .select("workflow_id, finished_at")
              .eq("id", parsed.runId)
              .maybeSingle();
            const { syncRedditWarmupRun } = await import(
              "@/lib/reddit-warmup-sync.server"
            );
            await syncRedditWarmupRun(sb, {
              workflowId: runFull?.workflow_id ?? null,
              finishedAt: runFull?.finished_at ?? null,
              result: slimResult as Record<string, unknown> | null,
            });
          }
        } catch (e) {
          console.error("reddit warmup log sync error", e);
        }


        // Monitor workflow utófeldolgozás (Decathlon stb.) — később bővül.
        try {
          const { handleRunCompletion } = await import(
            "@/lib/monitors/dispatch.server"
          );
          await handleRunCompletion(parsed.runId);
        } catch (e) {
          // ne dőljön meg a worker-complete, ha az értesítés hibára fut
          console.error("monitor dispatch error", e);
        }
        // Audit QA szinkron: ha ez egy kylo-study-qa run volt, tükrözzük a
        // végállapotot az audit_qa_runs sorra, hogy a UI ne maradjon "running"-on.
        try {
          const { data: runFull } = await sb
            .from("brain_workflow_runs")
            .select("spec_snapshot")
            .eq("id", parsed.runId)
            .maybeSingle();
          const spec = (runFull?.spec_snapshot ?? {}) as Record<string, unknown>;
          const auditQa = (spec.audit_qa ?? null) as { run_id?: string } | null;
          if (auditQa?.run_id) {
            const finalStatus =
              parsed.status === "succeeded"
                ? "completed"
                : parsed.status === "cancelled"
                  ? "stopped"
                  : "failed";
            await sb
              .from("audit_qa_runs")
              .update({
                status: finalStatus,
                finished_at: new Date().toISOString(),
              } as never)
              .eq("id", auditQa.run_id);
          }
        } catch (e) {
          console.error("audit_qa mirror error", e);
        }


        // Kylogic-task callback: ha a run egy brain_task_queue sorhoz tartozik,
        // frissítjük a task státuszát és kilövünk egy callbacket Kylogicnak.
        if (runRow?.brain_task_id) {
          try {
            const { data: taskRow } = await sb
              .from("brain_task_queue")
              .select(
                "id, kylogic_task_id, tenant_id, task_type, kylogic_callback_url, status",
              )
              .eq("id", runRow.brain_task_id)
              .maybeSingle();

            if (taskRow) {
              const finalStatus =
                parsed.status === "succeeded" ? "succeeded" : "failed";

              await sb
                .from("brain_task_queue")
                .update({
                  status: finalStatus,
                  result: (parsed.result ?? null) as never,
                  error: parsed.error ?? null,
                  completed_at: new Date().toISOString(),
                })
                .eq("id", taskRow.id);

              // Callback push — Kylogic elvárt shape-je.
              const { sendKylogicCallback, sendKylogicAudit } = await import(
                "@/lib/kylogic-bridge.server"
              );
              const cb = await sendKylogicCallback(taskRow.kylogic_callback_url, {
                task_id: taskRow.kylogic_task_id,
                tenant_id: taskRow.tenant_id,
                status: finalStatus === "succeeded" ? "completed" : "failed",
                result: parsed.result ?? undefined,
                error: parsed.error ?? undefined,
              });

              await sb.from("kylogic_incoming_task_log").insert({
                task_id: taskRow.kylogic_task_id,
                event: cb.ok ? "callback.sent" : "callback.failed",
                outcome: cb.ok ? "success" : "failure",
                detail: cb.ok
                  ? { status: cb.status, task_type: taskRow.task_type }
                  : {
                      status: cb.status,
                      error: cb.error,
                      body: (cb as { body?: string }).body,
                      task_type: taskRow.task_type,
                    },
              });

              await sendKylogicAudit({
                tenant_id: taskRow.tenant_id,
                event: `task.${finalStatus}`,
                outcome: finalStatus === "succeeded" ? "success" : "failure",
                task_id: taskRow.kylogic_task_id,
                detail: { task_type: taskRow.task_type, callback_ok: cb.ok },
              }).catch(() => undefined);
            }
          } catch (e) {
            console.error("[worker/complete] Kylogic callback flow failed", e);
          }
        }



        return Response.json({ ok: true });
      },
    },
  },
});
