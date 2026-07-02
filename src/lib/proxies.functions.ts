import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptString, decryptString } from "@/lib/credentials/crypto.server";

function maskUsername(u: string | null): string | null {
  if (!u) return null;
  if (u.length <= 2) return "•".repeat(u.length || 1);
  return u[0] + "•".repeat(Math.max(1, u.length - 2)) + u[u.length - 1];
}

const inputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  country: z.string().trim().max(4).default(""),
  provider: z.string().trim().max(80).default(""),
  kind: z.enum(["isp", "residential", "datacenter", "mobile"]).default("isp"),
  protocol: z.enum(["http", "socks5"]).default("http"),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  notes: z.string().max(2000).default(""),
  is_active: z.boolean().default(true),
});

export const listProxies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("proxies")
      .select(
        "id, label, country, provider, kind, protocol, host, port, username_ciphertext, username_nonce, password_ciphertext, notes, is_active, updated_at",
      )
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Decrypt username for display (masked), never expose password.
    const rows = await Promise.all(
      (data ?? []).map(async (r) => {
        let username: string | null = null;
        if (r.username_ciphertext && r.username_nonce) {
          try {
            username = await decryptString(r.username_ciphertext, r.username_nonce);
          } catch {
            username = null;
          }
        }
        return {
          id: r.id,
          label: r.label,
          country: r.country,
          provider: r.provider,
          kind: r.kind,
          protocol: r.protocol,
          host: r.host,
          port: r.port,
          usernameMasked: maskUsername(username),
          hasPassword: !!r.password_ciphertext,
          notes: r.notes,
          is_active: r.is_active,
          updated_at: r.updated_at,
        };
      }),
    );
    return rows;
  });

export const createProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: prof, error: pErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const tenantId = (prof as { tenant_id: string } | null)?.tenant_id;
    if (!tenantId) throw new Error("Nincs tenant hozzárendelve a felhasználóhoz.");
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      label: data.label,
      country: data.country.toUpperCase(),
      provider: data.provider,
      kind: data.kind,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      notes: data.notes,
      is_active: data.is_active,
    };
    if (data.username && data.username.length > 0) {
      const enc = await encryptString(data.username);
      payload.username_ciphertext = enc.ciphertext;
      payload.username_nonce = enc.nonce;
    }
    if (data.password && data.password.length > 0) {
      const enc = await encryptString(data.password);
      payload.password_ciphertext = enc.ciphertext;
      payload.password_nonce = enc.nonce;
    }
    const { data: row, error } = await context.supabase
      .from("proxies")
      .insert(payload as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id };
  });

export const updateProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    inputSchema
      .extend({
        id: z.string().uuid(),
        clearPassword: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = {
      label: data.label,
      country: data.country.toUpperCase(),
      provider: data.provider,
      kind: data.kind,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      notes: data.notes,
      is_active: data.is_active,
    };
    if (data.username !== undefined) {
      if (data.username.length === 0) {
        payload.username_ciphertext = null;
        payload.username_nonce = null;
      } else {
        const enc = await encryptString(data.username);
        payload.username_ciphertext = enc.ciphertext;
        payload.username_nonce = enc.nonce;
      }
    }
    if (data.password && data.password.length > 0) {
      const enc = await encryptString(data.password);
      payload.password_ciphertext = enc.ciphertext;
      payload.password_nonce = enc.nonce;
    } else if (data.clearPassword) {
      payload.password_ciphertext = null;
      payload.password_nonce = null;
    }
    const { error } = await context.supabase
      .from("proxies")
      .update(payload as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("proxies")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * SZERVER-OLDALI helper: futtatáskor visszaadja a proxy teljes URL-jét
 * (pl. `http://user:pass@host:port`). Soha ne hívd kliensből.
 */
function serverSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function loadProxyUrlServer(proxyId: string): Promise<string | null> {
  const supabase = serverSupabase();
  const { data: row, error } = await supabase
    .from("proxies")
    .select("*")
    .eq("id", proxyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const r = row as {
    protocol: string;
    host: string;
    port: number;
    username_ciphertext: string | null;
    username_nonce: string | null;
    password_ciphertext: string | null;
    password_nonce: string | null;
  };
  let auth = "";
  if (r.username_ciphertext && r.username_nonce) {
    const u = await decryptString(r.username_ciphertext, r.username_nonce);
    let p = "";
    if (r.password_ciphertext && r.password_nonce) {
      p = await decryptString(r.password_ciphertext, r.password_nonce);
    }
    auth = `${encodeURIComponent(u)}${p ? `:${encodeURIComponent(p)}` : ""}@`;
  }
  return `${r.protocol}://${auth}${r.host}:${r.port}`;
}
