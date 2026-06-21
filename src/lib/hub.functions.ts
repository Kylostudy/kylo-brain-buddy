/**
 * Server functions wrapping Hub cross-module integration.
 *
 * Client-safe to import (handler bodies are stripped from client bundles).
 * The actual Hub HMAC client is loaded inside handlers via dynamic import
 * to avoid leaking server-only modules into client chunks.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EnsureTenantResult =
  | { ok: true; tenant_id: string; created: boolean; cached: boolean }
  | { ok: false; error: string };

/**
 * Ensures the current authenticated user has a tenant_id registered with the
 * KyloGateway Hub. Idempotent: if the profile already has a tenant_id we
 * return it without calling Hub.
 *
 * Returns a structured result (never throws on Hub failure) so it can be
 * called fire-and-forget from the client without breaking the UI.
 */
export const ensureTenantRegistered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EnsureTenantResult> => {
    const { supabase, userId, claims } = context;

    // 1) Check profile first.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tenant_id, email")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) {
      return { ok: false, error: `Profile lookup failed: ${profileErr.message}` };
    }

    if (profile?.tenant_id) {
      return {
        ok: true,
        tenant_id: profile.tenant_id,
        created: false,
        cached: true,
      };
    }

    // 2) Determine email for Hub registration.
    const email =
      profile?.email ??
      (typeof claims.email === "string" ? claims.email : undefined);

    if (!email) {
      return { ok: false, error: "No email available for tenant registration" };
    }

    // 3) Register with Hub.
    const { hubRegisterTenant } = await import("./hub-client.server");
    const hubRes = await hubRegisterTenant(userId, email);

    if (!hubRes.ok) {
      console.error("[Hub] register failed", hubRes);
      return { ok: false, error: hubRes.error };
    }

    const tenantId = hubRes.data.tenant_id;

    // 4) Persist tenant_id on the profile (upsert in case row doesn't exist
    //    yet — handle_new_user trigger normally creates it, but be defensive).
    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          email,
          tenant_id: tenantId,
          tenant_id_resolved_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    if (upsertErr) {
      console.error("[Hub] failed to persist tenant_id", upsertErr);
      // Tenant is registered upstream — still return success so the caller
      // can proceed; next call will retry the persist via the same path.
      return {
        ok: true,
        tenant_id: tenantId,
        created: hubRes.data.created,
        cached: false,
      };
    }

    return {
      ok: true,
      tenant_id: tenantId,
      created: hubRes.data.created,
      cached: false,
    };
  });
