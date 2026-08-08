// Kylo Vault — ügynök életjel. Ezt olvassa vissza a Kit „online" jelzése.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { authenticateAgent, json } from "@/lib/vault-agents.server";

const Body = z.object({
  hostname: z.string().max(200).nullish(),
  platform: z.string().max(100).nullish(),
  version: z.string().max(50).nullish(),
  folders: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        label: z.string().max(200).nullish(),
        file_count: z.number().int().min(0).nullish(),
        size_bytes: z.number().int().min(0).nullish(),
        last_synced_at: z.string().nullish(),
        last_error: z.string().max(2000).nullish(),
      }),
    )
    .max(200)
    .optional(),
});

export const Route = createFileRoute("/api/public/vault/agent/heartbeat")({
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

        await supabaseAdmin
          .from("vault_agents")
          .update({
            last_seen_at: now,
            hostname: p.hostname ?? agent.hostname,
            platform: p.platform ?? agent.platform,
            version: p.version ?? agent.version,
          })
          .eq("id", agent.id);

        if (p.folders?.length) {
          const rows = p.folders.map((f) => ({
            agent_id: agent.id,
            path: f.path,
            label: f.label ?? null,
            file_count: f.file_count ?? 0,
            size_bytes: f.size_bytes ?? 0,
            last_synced_at: f.last_synced_at ?? null,
            last_error: f.last_error ?? null,
          }));
          const { error } = await supabaseAdmin
            .from("vault_agent_folders")
            .upsert(rows, { onConflict: "agent_id,path" });
          if (error) return json({ error: error.message }, 500);
        }

        return json({ ok: true, agent_id: agent.id, server_time: now });
      },
    },
  },
});
