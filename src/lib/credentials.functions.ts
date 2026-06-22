import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptString, decryptString } from "@/lib/credentials/crypto.server";

function serverSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Visszaadja, hogy egy workflow-hoz van-e mentve credential, és melyik mezők ki vannak töltve.
 * SOHA nem ad vissza nyers jelszót vagy cookie-t. Maszkolva mutatja a usernevet.
 */
export const getCredentialsStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("workflow_credentials")
      .select(
        "platform, username, password_ciphertext, cookie_ciphertext, totp_secret_ciphertext, proxy_ciphertext, updated_at",
      )
      .eq("workflow_id", data.workflowId)
      .maybeSingle();

    if (!row) {
      return {
        exists: false,
        platform: null as string | null,
        usernameMasked: null as string | null,
        hasPassword: false,
        hasCookie: false,
        hasTotp: false,
        hasProxy: false,
        updatedAt: null as string | null,
      };
    }

    const u = row.username ?? "";
    const masked =
      u.length <= 2
        ? "•".repeat(u.length || 1)
        : u[0] + "•".repeat(Math.max(1, u.length - 2)) + u[u.length - 1];

    return {
      exists: true,
      platform: row.platform,
      usernameMasked: u ? masked : null,
      hasPassword: !!row.password_ciphertext,
      hasCookie: !!row.cookie_ciphertext,
      hasTotp: !!row.totp_secret_ciphertext,
      hasProxy: !!(row as { proxy_ciphertext?: string | null }).proxy_ciphertext,
      updatedAt: row.updated_at,
    };
  });

/**
 * Mentés / felülírás. Csak azt a mezőt írja, amit kapott.
 * Ha üres stringet kapsz, az NEM törli a meglévőt — explicit `clearPassword`/`clearCookie`/`clearTotp` kell hozzá.
 */
export const saveCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        platform: z.string().min(1).max(40),
        username: z.string().min(1).max(200),
        password: z.string().min(1).max(500).optional(),
        cookie: z.string().min(1).max(50000).optional(),
        totpSecret: z.string().min(1).max(200).optional(),
        proxy: z.string().min(1).max(500).optional(),
        clearPassword: z.boolean().optional(),
        clearCookie: z.boolean().optional(),
        clearTotp: z.boolean().optional(),
        clearProxy: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // encryptString → server-only import a fájl tetején
    const { supabase } = context;

    // Olvassuk be a meglévőt (ha van) — hogy a nem érintett mezőket megtartsuk.
    const { data: existing } = await supabase
      .from("workflow_credentials")
      .select("*")
      .eq("workflow_id", data.workflowId)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      workflow_id: data.workflowId,
      platform: data.platform.trim().toLowerCase(),
      username: data.username.trim(),
    };

    if (data.password !== undefined) {
      const { ciphertext, nonce } = await encryptString(data.password);
      payload.password_ciphertext = ciphertext;
      payload.password_nonce = nonce;
    } else if (data.clearPassword) {
      payload.password_ciphertext = null;
      payload.password_nonce = null;
    } else if (existing) {
      payload.password_ciphertext = existing.password_ciphertext;
      payload.password_nonce = existing.password_nonce;
    }

    if (data.cookie !== undefined) {
      const { ciphertext, nonce } = await encryptString(data.cookie);
      payload.cookie_ciphertext = ciphertext;
      payload.cookie_nonce = nonce;
    } else if (data.clearCookie) {
      payload.cookie_ciphertext = null;
      payload.cookie_nonce = null;
    } else if (existing) {
      payload.cookie_ciphertext = existing.cookie_ciphertext;
      payload.cookie_nonce = existing.cookie_nonce;
    }

    if (data.totpSecret !== undefined) {
      const { ciphertext, nonce } = await encryptString(data.totpSecret);
      payload.totp_secret_ciphertext = ciphertext;
      payload.totp_nonce = nonce;
    } else if (data.clearTotp) {
      payload.totp_secret_ciphertext = null;
      payload.totp_nonce = null;
    } else if (existing) {
      payload.totp_secret_ciphertext = existing.totp_secret_ciphertext;
      payload.totp_nonce = existing.totp_nonce;
    }

    if (data.proxy !== undefined) {
      const { ciphertext, nonce } = await encryptString(data.proxy);
      payload.proxy_ciphertext = ciphertext;
      payload.proxy_nonce = nonce;
    } else if (data.clearProxy) {
      payload.proxy_ciphertext = null;
      payload.proxy_nonce = null;
    } else if (existing && "proxy_ciphertext" in existing) {
      payload.proxy_ciphertext = (existing as { proxy_ciphertext?: string | null }).proxy_ciphertext ?? null;
      payload.proxy_nonce = (existing as { proxy_nonce?: string | null }).proxy_nonce ?? null;
    }


    const { error } = await supabase
      .from("workflow_credentials")
      .upsert(payload as never, { onConflict: "workflow_id" });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const deleteCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("workflow_credentials")
      .delete()
      .eq("workflow_id", data.workflowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * SZERVER-OLDALI segédfüggvény: futtatáskor visszafejti és visszaadja a teljes credentialt.
 * Soha ne hívd kliensből — ez nem egy server function, csak `*.server.ts`-ből importálható.
 */
export async function loadDecryptedCredentialsServer(workflowId: string) {
  // decryptString → server-only import a fájl tetején
  const supabase = serverSupabase();
  const { data: row, error } = await supabase
    .from("workflow_credentials")
    .select("*")
    .eq("workflow_id", workflowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  return {
    platform: row.platform,
    username: row.username,
    password:
      row.password_ciphertext && row.password_nonce
        ? decryptString(row.password_ciphertext, row.password_nonce)
        : null,
    cookie:
      row.cookie_ciphertext && row.cookie_nonce
        ? decryptString(row.cookie_ciphertext, row.cookie_nonce)
        : null,
    totpSecret:
      row.totp_secret_ciphertext && row.totp_nonce
        ? decryptString(row.totp_secret_ciphertext, row.totp_nonce)
        : null,
    proxy:
      (row as { proxy_ciphertext?: string | null }).proxy_ciphertext &&
      (row as { proxy_nonce?: string | null }).proxy_nonce
        ? decryptString(
            (row as { proxy_ciphertext: string }).proxy_ciphertext,
            (row as { proxy_nonce: string }).proxy_nonce,
          )
        : null,
  };
}
