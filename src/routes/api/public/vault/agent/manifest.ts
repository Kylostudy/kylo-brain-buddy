// Kylo Vault — ügynök manifeszt: melyik fájlokat kell feltölteni?
// Az ügynök elküldi a mappa fájllistáját (relatív út, méret, módosítás, hash),
// a Brain összeveti a nyilvántartással, és csak a különbözetet kéri be.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  authenticateAgent,
  folderSlug,
  json,
  sanitizeRel,
} from "@/lib/vault-agents.server";

const Body = z.object({
  folder: z.string().min(1).max(1024),
  label: z.string().max(200).nullish(),
  files: z
    .array(
      z.object({
        rel: z.string().min(1).max(1024),
        size: z.number().int().min(0).max(2 * 1024 * 1024 * 1024),
        mtime: z.number().int().nullish(),
        hash: z.string().max(200).nullish(),
      }),
    )
    .max(20000),
});

export const Route = createFileRoute("/api/public/vault/agent/manifest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const agent = await authenticateAgent(request);
        if (!agent) return json({ error: "unauthorized" }, 401);

        let p: z.infer<typeof Body>;
        try {
          p = Body.parse(await request.json());
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "bad request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();

        const totalSize = p.files.reduce((n, f) => n + f.size, 0);
        const { data: folder, error: folderErr } = await supabaseAdmin
          .from("vault_agent_folders")
          .upsert(
            {
              agent_id: agent.id,
              path: p.folder,
              label: p.label ?? null,
              file_count: p.files.length,
              size_bytes: totalSize,
              last_error: null,
            },
            { onConflict: "agent_id,path" },
          )
          .select("id")
          .single();
        if (folderErr || !folder) {
          return json({ error: folderErr?.message ?? "mappa mentése sikertelen" }, 500);
        }

        const { data: known, error: knownErr } = await supabaseAdmin
          .from("vault_agent_files")
          .select("rel,size,hash")
          .eq("folder_id", folder.id);
        if (knownErr) return json({ error: knownErr.message }, 500);

        const map = new Map((known ?? []).map((r) => [r.rel, r]));
        const need: string[] = [];
        for (const f of p.files) {
          const rel = sanitizeRel(f.rel);
          if (!rel) continue;
          const prev = map.get(rel);
          if (!prev) {
            need.push(f.rel);
            continue;
          }
          const sameHash = f.hash && prev.hash ? f.hash === prev.hash : false;
          const sameSize = Number(prev.size) === f.size;
          if (!sameHash && !(sameSize && !f.hash)) need.push(f.rel);
        }

        await supabaseAdmin
          .from("vault_agents")
          .update({ last_seen_at: now })
          .eq("id", agent.id);

        return json({ need, slug: folderSlug(p.folder), total: p.files.length });
      },
    },
  },
});
