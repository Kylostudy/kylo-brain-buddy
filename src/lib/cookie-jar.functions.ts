import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Visszaadja a workflow cookie jar állapotát: melyik ország sütijeit gyűjtöttük,
 * zárolva van-e, mikor frissült utoljára, és mennyi sütit / domain-t tartalmaz.
 */
export const getCookieJarStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("workflows")
      .select("cookie_jar_country, cookie_jar_locked, cookie_jar_updated_at, cookie_jar_stats")
      .eq("id", data.workflowId)
      .maybeSingle();

    const { data: cred } = await supabase
      .from("workflow_credentials")
      .select("cookie_ciphertext")
      .eq("workflow_id", data.workflowId)
      .maybeSingle();

    const hasCookies = !!cred?.cookie_ciphertext;
    const stats = (row?.cookie_jar_stats ?? null) as
      | { cookies?: number | null; domains?: number | null }
      | null;

    return {
      country: (row?.cookie_jar_country ?? null) as string | null,
      locked: !!row?.cookie_jar_locked,
      updatedAt: (row?.cookie_jar_updated_at ?? null) as string | null,
      cookies: stats?.cookies ?? null,
      domains: stats?.domains ?? null,
      hasCookies,
    };
  });

/**
 * Cookie jar védelmi kapcsoló ki/be. Ha bekapcsolva, a UI csak azonos országú
 * proxyt enged választani; ha kikapcsolva, csak figyelmeztetés van.
 */
export const setCookieJarLocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ workflowId: z.string().uuid(), locked: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("workflows")
      .update({ cookie_jar_locked: data.locked } as never)
      .eq("id", data.workflowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Cookie jar teljes nullázása: mentett sütik törlése, ország címke levétele,
 * védelem kikapcsolása. Ezek után szabadon váltható a proxy ország.
 */
export const clearCookieJar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // A workflow_credentials sor létezhet más mezőkkel (jelszó, TOTP) —
    // csak a cookie részt nulláznunk kell, nem törölni a sort.
    const { error: credErr } = await supabase
      .from("workflow_credentials")
      .update({
        cookie_ciphertext: null,
        cookie_nonce: null,
      } as never)
      .eq("workflow_id", data.workflowId);
    if (credErr) throw new Error(credErr.message);

    const { error: wfErr } = await supabase
      .from("workflows")
      .update({
        cookie_jar_country: null,
        cookie_jar_locked: false,
        cookie_jar_updated_at: null,
        cookie_jar_stats: null,
      } as never)
      .eq("id", data.workflowId);
    if (wfErr) throw new Error(wfErr.message);

    return { ok: true };
  });
