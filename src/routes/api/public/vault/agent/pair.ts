// Kylo Vault — helyi ügynök párosítása.
// Ez az egyetlen ügynök-végpont, ami nem Bearer tokennel véd: a Kit felületén
// generált, 10 percig élő párosító kóddal lehet új gépet felvenni.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  agentEndpoint,
  generateAgentToken,
  isRateLimited,
  json,
  logAgentEvent,
  requestIp,
  sha256Hex,
} from "@/lib/vault-agents.server";

const Body = z.object({
  code: z.string().min(4).max(16),
  hostname: z.string().max(200).nullish(),
  platform: z.string().max(100).nullish(),
  version: z.string().max(50).nullish(),
});

export const Route = createFileRoute("/api/public/vault/agent/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = requestIp(request);
        if (await isRateLimited("agent_pair_fail", ip, 10)) {
          return json({ error: "túl sok próbálkozás" }, 429);
        }

        let p: z.infer<typeof Body>;
        try {
          p = Body.parse(await request.json());
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "bad request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const codeHash = sha256Hex(p.code.trim().toUpperCase());

        const { data: pairRow } = await supabaseAdmin
          .from("vault_pair_codes")
          .select("id,tenant_id,expires_at,used_at")
          .eq("code_hash", codeHash)
          .maybeSingle();

        if (!pairRow || pairRow.used_at || new Date(pairRow.expires_at).getTime() < Date.now()) {
          await logAgentEvent("agent_pair_fail", { ip, detail: { hostname: p.hostname ?? null } });
          return json({ error: "érvénytelen vagy lejárt kód" }, 401);
        }

        // A kódot azonnal elégetjük (versenyhelyzet ellen feltételes frissítés).
        const { data: burned } = await supabaseAdmin
          .from("vault_pair_codes")
          .update({ used_at: new Date().toISOString() })
          .eq("id", pairRow.id)
          .is("used_at", null)
          .select("id")
          .maybeSingle();
        if (!burned) {
          await logAgentEvent("agent_pair_fail", { ip, detail: { reason: "already_used" } });
          return json({ error: "érvénytelen vagy lejárt kód" }, 401);
        }

        const token = generateAgentToken();
        const { data: agent, error } = await supabaseAdmin
          .from("vault_agents")
          .insert({
            tenant_id: pairRow.tenant_id,
            token_hash: sha256Hex(token),
            hostname: p.hostname ?? null,
            platform: p.platform ?? null,
            version: p.version ?? null,
            last_seen_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error || !agent) return json({ error: error?.message ?? "sikertelen párosítás" }, 500);

        await logAgentEvent("agent_pair", {
          ip,
          tenantId: pairRow.tenant_id,
          agentId: agent.id,
          detail: { hostname: p.hostname ?? null, platform: p.platform ?? null },
        });

        return json({
          agent_id: agent.id,
          agent_token: token,
          endpoint: agentEndpoint(),
        });
      },
    },
  },
});
