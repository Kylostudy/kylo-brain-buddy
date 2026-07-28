// Reddit fiókok — importálás (felhasználónév + jelszó), regisztráció és
// bejelentkezett fiók-melegítés indítása.
//
// FONTOS fogalmi különbség:
//   - "Reddit warmup"  = a MEGLÉVŐ Reddit fiók bemelegítése (bejelentkezve
//     görgetés, upvote, subreddit nézelődés).
//   - "országos warmup" = kijelentkezett sütigyűjtés a proxyn (más rendszer).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** A Reddit workflow-k neve "Red " előtaggal kezdődik. */
const REDDIT_PREFIX = "Red ";

export const listRedditWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: wfs, error } = await supabase
      .from("workflows")
      .select("id, name")
      .ilike("name", `${REDDIT_PREFIX}%`)
      .order("name");
    if (error) throw new Error(error.message);

    const ids = (wfs ?? []).map((w) => w.id);
    if (ids.length === 0) return [];

    const [{ data: creds }, { data: accounts }, { data: proxies }] = await Promise.all([
      supabase
        .from("workflow_credentials")
        .select("workflow_id, username, password_ciphertext, cookie_ciphertext, proxy_id")
        .in("workflow_id", ids),
      supabase
        .from("reddit_accounts")
        .select("id, workflow_id, username, warmup_status, warmup_days_completed, karma, proxy_id")
        .in("workflow_id", ids),
      supabase.from("proxies").select("id, label, country, is_active"),
    ]);

    const proxyById = new Map((proxies ?? []).map((p) => [p.id, p]));

    return (wfs ?? []).map((w) => {
      const c = (creds ?? []).find((x) => x.workflow_id === w.id);
      const a = (accounts ?? []).find((x) => x.workflow_id === w.id);
      const proxy = c?.proxy_id ? proxyById.get(c.proxy_id) : null;
      return {
        workflow_id: w.id,
        name: w.name,
        country: proxy?.country ?? null,
        proxy_id: proxy?.id ?? null,
        proxy_label: proxy?.label ?? null,
        has_cookies: !!c?.cookie_ciphertext,
        has_password: !!c?.password_ciphertext,
        username: a?.username ?? c?.username ?? null,
        account_id: a?.id ?? null,
        warmup_status: a?.warmup_status ?? null,
        warmup_days_completed: a?.warmup_days_completed ?? 0,
        karma: a?.karma ?? null,
      };
    });
  });

/**
 * Tömeges fiók-import. Soronként:
 *   ORSZÁGKÓD ; felhasználónév ; jelszó [; email]
 * Elválasztó lehet `;`, `|`, tabulátor vagy vessző.
 * A jelszó AES-256-GCM-mel titkosítva kerül a workflow_credentials-be.
 */
export const importRedditAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1).max(20000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { encryptString } = await import("@/lib/credentials/crypto.server");

    const { data: prof } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("Hiányzik a tenant azonosító.");

    const { data: proxies } = await supabase
      .from("proxies")
      .select("id, country, label")
      .eq("is_active", true);
    const { data: wfs } = await supabase
      .from("workflows")
      .select("id, name")
      .ilike("name", `${REDDIT_PREFIX}%`);
    const { data: creds } = await supabase
      .from("workflow_credentials")
      .select("id, workflow_id, proxy_id");

    const results: { line: string; ok: boolean; message: string }[] = [];

    for (const raw of data.text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/[;|\t,]/).map((s) => s.trim());
      const [countryRaw, username, password, email] = parts;
      if (!countryRaw || !username || !password) {
        results.push({ line, ok: false, message: "Hiányzó mező (ország; név; jelszó)" });
        continue;
      }
      const country = countryRaw.toUpperCase();
      const proxy = (proxies ?? []).find((p) => p.country?.toUpperCase() === country);
      if (!proxy) {
        results.push({ line, ok: false, message: `Nincs aktív proxy ehhez: ${country}` });
        continue;
      }
      // A proxyhoz tartozó Reddit workflow: a credentials proxy_id-n keresztül.
      const credForProxy = (creds ?? []).find(
        (c) => c.proxy_id === proxy.id && (wfs ?? []).some((w) => w.id === c.workflow_id),
      );
      const wf = credForProxy
        ? (wfs ?? []).find((w) => w.id === credForProxy.workflow_id)
        : null;
      if (!wf) {
        results.push({ line, ok: false, message: `Nincs Reddit workflow ehhez: ${country}` });
        continue;
      }

      const enc = await encryptString(password);
      const { error: credErr } = await supabase
        .from("workflow_credentials")
        .update({
          platform: "reddit",
          username,
          password_ciphertext: enc.ciphertext,
          password_nonce: enc.nonce,
        })
        .eq("id", credForProxy!.id);
      if (credErr) {
        results.push({ line, ok: false, message: credErr.message });
        continue;
      }

      const { data: existing } = await supabase
        .from("reddit_accounts")
        .select("id")
        .eq("workflow_id", wf.id)
        .maybeSingle();

      const payload = {
        username,
        proxy_id: proxy.id,
        language: country,
        notes: email ? `email: ${email}` : null,
        status: "active",
      };
      const { error: accErr } = existing
        ? await supabase.from("reddit_accounts").update(payload).eq("id", existing.id)
        : await supabase.from("reddit_accounts").insert({
            ...payload,
            tenant_id: tenantId,
            workflow_id: wf.id,
            locale: "en-US",
            warmup_status: "not_started",
          });
      if (accErr) {
        results.push({ line, ok: false, message: accErr.message });
        continue;
      }
      results.push({ line: `${country} · ${username}`, ok: true, message: `Mentve — ${wf.name}` });
    }

    const okCount = results.filter((r) => r.ok).length;
    return { imported: okCount, failed: results.length - okCount, results };
  });

/**
 * Futás sorba állítása egy Reddit workflow-ra.
 *   task_type = "reddit_register" → új fiók regisztrálása a proxy sütijeivel
 *   task_type = "reddit_warmup"   → bejelentkezett fiók bemelegítése
 */
export const startRedditTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflow_ids: z.array(z.string().uuid()).min(1).max(30),
        task_type: z.enum(["reddit_register", "reddit_warmup"]),
        duration_min: z.number().int().min(5).max(120).default(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: wfs, error } = await supabase
      .from("workflows")
      .select("id, name, spec, tenant_id, module")
      .in("id", data.workflow_ids);
    if (error) throw new Error(error.message);

    const nowIso = new Date().toISOString();
    let queued = 0;
    for (const wf of wfs ?? []) {
      const { data: cred } = await supabase
        .from("workflow_credentials")
        .select("proxy_id")
        .eq("workflow_id", wf.id)
        .maybeSingle();

      const spec = {
        ...((wf.spec as Record<string, unknown> | null) ?? {}),
        platform: "reddit",
        brain_task: {
          task_type: data.task_type,
          platform: "reddit",
          duration_min: data.duration_min,
        },
      };

      const { error: insErr } = await supabase.from("brain_workflow_runs").insert({
        workflow_id: wf.id,
        tenant_id: wf.tenant_id,
        module: wf.module,
        runner: "docker",
        status: "queued",
        spec_snapshot: spec as never,
        proxy_id: cred?.proxy_id ?? null,
        logs: [
          {
            ts: nowIso,
            level: "info",
            message:
              data.task_type === "reddit_register"
                ? `Reddit regisztráció sorba téve — ${wf.name}`
                : `Reddit fiók-melegítés sorba téve (${data.duration_min} perc) — ${wf.name}`,
          },
        ] as never,
      });
      if (insErr) throw new Error(insErr.message);

      if (data.task_type === "reddit_warmup") {
        await supabase
          .from("reddit_accounts")
          .update({ warmup_status: "in_progress", warmup_started_at: nowIso })
          .eq("workflow_id", wf.id);
      }
      queued++;
    }
    return { queued };
  });
