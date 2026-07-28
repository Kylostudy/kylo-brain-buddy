// Worker run completion endpoint — a VPS worker hívja, amikor a futás befejeződött
// (sikeres, hibára futott, vagy megszakadt). A logokat és a végeredményt írja vissza.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
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
        const flowChecked = res?.kylo_flow_checked === true;
        const flowFailed =
          parsed.status === "succeeded" && flowChecked && res?.flow_ok !== true;
        const criteriaFailed = Array.isArray(res?.criteria_failed)
          ? (res?.criteria_failed as string[])
          : [];
        const flowReason = criteriaFailed.length > 0
          ? `Nem teljesült kritériumok: ${criteriaFailed.join(", ")}`
          : flowChecked
            ? `A folyamat nem ért célba: fizetés (Stripe) ${res?.reached_stripe ? "IGEN" : "NEM"}, profil oldal ${res?.reached_profile ? "IGEN" : "NEM"}`
            : "";

        const failedReasons = [
          languageFailed
            ? `Nyelvi ellenőrzés bukott: nem a(z) ${expectedLang ?? "várt"} nyelv jelent meg`
            : null,
          flowFailed ? flowReason : null,
          parsed.error ?? null,
        ].filter(Boolean);


        const update: Record<string, unknown> = {
          status: languageFailed || flowFailed ? "failed" : parsed.status,
          logs: trimmedLogs as never,
          result: slimResult as never,
          error: failedReasons.length > 0 ? failedReasons.join(" — ") : null,
          finished_at: new Date().toISOString(),
        };

        if (parsed.preflight !== undefined) {
          update.preflight_result = parsed.preflight as never;
        }

        const { data: runRow, error } = await sb
          .from("brain_workflow_runs")
          .update(update as never)
          .eq("id", parsed.runId)
          .select("id, brain_task_id, tenant_id")
          .maybeSingle();


        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        // Teszt fiók állapota: ha a Sign Up futás végigment, a hozzá tartozó
        // alias e-mail + jelszó pár „regisztrált" lesz, így később belépésre
        // használható; ha bukott, jelöljük hibásnak.
        try {
          if (flowChecked) {
            const registered = !languageFailed && !flowFailed && parsed.status === "succeeded";
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
                workflow_id: runFull.workflow_id,
                tenant_id: runFull.tenant_id,
                platform: existing?.platform ?? "warmup",
                username: existing?.username ?? "warmup-jar",
                cookie_ciphertext: ciphertext,
                cookie_nonce: nonce,
                proxy_id: runFull.proxy_id,
              };
              await sb
                .from("workflow_credentials")
                .upsert(payload as never, { onConflict: "workflow_id" });

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
                  .select("workflow_id, platform, username")
                  .eq("proxy_id", runFull.proxy_id)
                  .neq("workflow_id", runFull.workflow_id);

                const siblingIds = (siblingCreds ?? [])
                  .map((row) => row.workflow_id)
                  .filter(Boolean);

                if (siblingCreds && siblingCreds.length > 0) {
                  await sb.from("workflow_credentials").upsert(
                    siblingCreds.map((row) => ({
                      workflow_id: row.workflow_id,
                      tenant_id: runFull.tenant_id,
                      platform: row.platform ?? "warmup",
                      username: row.username ?? "warmup-jar",
                      proxy_id: runFull.proxy_id,
                      cookie_ciphertext: ciphertext,
                      cookie_nonce: nonce,
                    })) as never,
                    { onConflict: "workflow_id" },
                  );
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
