// Kylo Vault — a VPS ügynöke ide jelenti be a széf állapotát és a talált
// könyvtárakat. Válaszként visszakapja, hogy melyik könyvtárak legyenek
// szinkronban (a Kit felületén beállított lista).
//
// Auth: WORKER_API_TOKEN(_V2) Bearer token, ugyanaz, mint a többi worker
// végpontnál. A /api/public/* előtag miatt nincs oldal-szintű bejelentkezés,
// ezért a hitelesítés itt, a kezelőben történik.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const FolderSchema = z.object({
  path: z.string().min(1).max(1024),
  label: z.string().max(200).nullish(),
  sizeBytes: z.number().int().min(0).nullish(),
  fileCount: z.number().int().min(0).nullish(),
  lastSyncedAt: z.string().datetime().nullish(),
  lastError: z.string().max(2000).nullish(),
});

const Body = z.object({
  tenantId: z.string().uuid(),
  host: z.string().max(200).nullish(),
  luksUnlocked: z.boolean().nullish(),
  mountOk: z.boolean().nullish(),
  diskTotalBytes: z.number().int().min(0).nullish(),
  diskUsedBytes: z.number().int().min(0).nullish(),
  diskFreeBytes: z.number().int().min(0).nullish(),
  mirrorUsedBytes: z.number().int().min(0).nullish(),
  mirrorOk: z.boolean().nullish(),
  lastMirrorAt: z.string().datetime().nullish(),
  lastError: z.string().max(4000).nullish(),
  snapshots: z.array(z.string().max(100)).max(400).optional(),
  agentVersion: z.string().max(50).nullish(),
  folders: z.array(FolderSchema).max(500).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/worker/vault-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr) return json({ error: authErr }, 401);

        let p: z.infer<typeof Body>;
        try {
          p = Body.parse(await request.json());
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "bad request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();

        const { error: statusErr } = await supabaseAdmin.from("vault_status").upsert(
          {
            tenant_id: p.tenantId,
            host: p.host ?? null,
            luks_unlocked: p.luksUnlocked ?? null,
            mount_ok: p.mountOk ?? null,
            disk_total_bytes: p.diskTotalBytes ?? null,
            disk_used_bytes: p.diskUsedBytes ?? null,
            disk_free_bytes: p.diskFreeBytes ?? null,
            mirror_used_bytes: p.mirrorUsedBytes ?? null,
            mirror_ok: p.mirrorOk ?? null,
            last_mirror_at: p.lastMirrorAt ?? null,
            last_error: p.lastError ?? null,
            snapshots: p.snapshots ?? [],
            agent_version: p.agentVersion ?? null,
            reported_at: now,
          },
          { onConflict: "tenant_id" },
        );
        if (statusErr) {
          console.error("vault-report status upsert failed", statusErr);
          return json({ error: statusErr.message }, 500);
        }

        if (p.folders?.length) {
          // Csak a mérés-jellegű mezőket írjuk felül. Az `enabled` a felhasználó
          // döntése — azt a szerver soha nem bírálja felül.
          const rows = p.folders.map((f) => ({
            tenant_id: p.tenantId,
            path: f.path,
            label: f.label ?? null,
            size_bytes: f.sizeBytes ?? null,
            file_count: f.fileCount ?? null,
            last_synced_at: f.lastSyncedAt ?? null,
            last_error: f.lastError ?? null,
            seen_at: now,
          }));
          const { error: folderErr } = await supabaseAdmin
            .from("vault_folders")
            .upsert(rows, { onConflict: "tenant_id,path", ignoreDuplicates: false });
          if (folderErr) {
            console.error("vault-report folders upsert failed", folderErr);
            return json({ error: folderErr.message }, 500);
          }
        }

        const { data: enabled, error: readErr } = await supabaseAdmin
          .from("vault_folders")
          .select("path,label")
          .eq("tenant_id", p.tenantId)
          .eq("enabled", true)
          .order("path");
        if (readErr) {
          console.error("vault-report enabled read failed", readErr);
          return json({ error: readErr.message }, 500);
        }

        return json({
          ok: true,
          syncPaths: (enabled ?? []).map((r) => r.path),
        });
      },
    },
  },
});
