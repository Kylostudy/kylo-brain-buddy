// Kylo Vault — a Kit dashboard ezen keresztül olvassa és állítja a széf
// könyvtárlistáját, és itt kezeli a lejáró megosztó linkeket is.
// Hitelesítés: ugyanaz a Kit↔Brain HMAC séma, mint a cross/kit/task
// végpontnál (KIT_BRAIN_TASK_SECRET).
//
// Műveletek (body.action):
//   "state"         → állapot + teljes könyvtárlista
//   "set_enabled"   → egy könyvtár szinkronjának be/ki kapcsolása
//   "add_folder"    → kézzel felvett könyvtár (ha az ügynök még nem látta)
//   "remove_folder" → kézzel felvett könyvtár törlése a listából
//   "share_create"  → új lejáró megosztó link
//   "share_list"    → megosztások letöltésszámmal és utolsó hozzáféréssel
//   "share_revoke"  → megosztás visszavonása

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { verifyKitRequest } from "@/lib/kit-bridge.server";
import {
  defaultExpiryHours,
  generateShareToken,
  hashPassword,
} from "@/lib/vault-shares.server";

const ROUTE_PATH = "/api/public/cross/kit/vault";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), tenant_id: z.string().uuid() }),
  z.object({
    action: z.literal("set_enabled"),
    tenant_id: z.string().uuid(),
    path: z.string().min(1).max(1024),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("add_folder"),
    tenant_id: z.string().uuid(),
    path: z.string().min(1).max(1024),
    label: z.string().max(200).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("remove_folder"),
    tenant_id: z.string().uuid(),
    path: z.string().min(1).max(1024),
  }),
  z.object({
    action: z.literal("share_create"),
    tenant_id: z.string().uuid(),
    path: z.string().min(1).max(1024),
    label: z.string().max(200).optional(),
    expires_in_hours: z.number().int().min(1).max(24 * 365).optional(),
    password: z.string().min(4).max(200).optional(),
    max_downloads: z.number().int().min(1).max(100000).nullish(),
    allow_download: z.boolean().optional(),
  }),
  z.object({ action: z.literal("share_list"), tenant_id: z.string().uuid() }),
  z.object({
    action: z.literal("share_revoke"),
    tenant_id: z.string().uuid(),
    id: z.string().uuid(),
  }),
]);


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Opcionális szűkítés: csak egyetlen (a gazdi) tenant használhatja. */
function tenantAllowed(tenantId: string): boolean {
  const owner = process.env.VAULT_OWNER_TENANT_ID?.trim();
  if (!owner) return true;
  return owner.toLowerCase() === tenantId.toLowerCase();
}

export const Route = createFileRoute("/api/public/cross/kit/vault")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const verify = verifyKitRequest("task", "POST", ROUTE_PATH, rawBody, request.headers);
        if (!verify.ok) return json({ ok: false, error: verify.reason }, verify.status);

        let p: z.infer<typeof Body>;
        try {
          p = Body.parse(JSON.parse(rawBody));
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : "bad request" }, 400);
        }

        if (!tenantAllowed(p.tenant_id)) {
          return json({ ok: false, error: "Ehhez a bérlőhöz nincs Vault hozzáférés" }, 403);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (p.action === "set_enabled") {
          const { error } = await supabaseAdmin
            .from("vault_folders")
            .update({ enabled: p.enabled })
            .eq("tenant_id", p.tenant_id)
            .eq("path", p.path);
          if (error) return json({ ok: false, error: error.message }, 500);
        }

        if (p.action === "add_folder") {
          const { error } = await supabaseAdmin.from("vault_folders").upsert(
            {
              tenant_id: p.tenant_id,
              path: p.path,
              label: p.label ?? null,
              enabled: p.enabled ?? true,
              source: "manual",
            },
            { onConflict: "tenant_id,path" },
          );
          if (error) return json({ ok: false, error: error.message }, 500);
        }

        if (p.action === "remove_folder") {
          const { error } = await supabaseAdmin
            .from("vault_folders")
            .delete()
            .eq("tenant_id", p.tenant_id)
            .eq("path", p.path)
            .eq("source", "manual");
          if (error) return json({ ok: false, error: error.message }, 500);
        }

        const [{ data: status }, { data: folders, error: foldersErr }] = await Promise.all([
          supabaseAdmin
            .from("vault_status")
            .select("*")
            .eq("tenant_id", p.tenant_id)
            .maybeSingle(),
          supabaseAdmin
            .from("vault_folders")
            .select("path,label,enabled,source,size_bytes,file_count,last_synced_at,last_error,seen_at")
            .eq("tenant_id", p.tenant_id)
            .order("path"),
        ]);
        if (foldersErr) return json({ ok: false, error: foldersErr.message }, 500);

        return json({ ok: true, status: status ?? null, folders: folders ?? [] });
      },
    },
  },
});
