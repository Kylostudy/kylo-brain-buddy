// Kylo Vault — ügynök fájlfeltöltés.
// A nyers bájtok átfolynak a Brainen a VPS titkosított széfjébe; a Brain
// semmit nem tárol el belőlük. Az SHA-256 ellenőrzést a fájlkiszolgáló végzi
// írás közben (temp fájl + atomikus átnevezés).

import { createFileRoute } from "@tanstack/react-router";

import {
  MAX_UPLOAD_BYTES,
  agentVaultPath,
  authenticateAgent,
  decodeHeaderB64,
  folderSlug,
  json,
  logAgentEvent,
  requestIp,
  sanitizeRel,
  uploadToVault,
} from "@/lib/vault-agents.server";

export const Route = createFileRoute("/api/public/vault/agent/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const agent = await authenticateAgent(request);
        if (!agent) return json({ error: "unauthorized" }, 401);

        const folderPath = decodeHeaderB64(request.headers.get("x-vault-folder"));
        const relRaw = decodeHeaderB64(request.headers.get("x-vault-rel"));
        const mtime = request.headers.get("x-vault-mtime");
        const hash = request.headers.get("x-vault-hash");
        const lengthHeader = request.headers.get("content-length");

        if (!folderPath || !relRaw) return json({ error: "hiányzó útvonal fejléc" }, 400);
        const rel = sanitizeRel(relRaw);
        if (!rel) return json({ error: "tiltott relatív útvonal" }, 400);

        const size = Number(lengthHeader ?? 0);
        if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
          return json({ error: "a fájl nagyobb 2 GB-nál" }, 413);
        }
        if (!request.body) return json({ error: "üres kérés" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: folder } = await supabaseAdmin
          .from("vault_agent_folders")
          .select("id")
          .eq("agent_id", agent.id)
          .eq("path", folderPath)
          .maybeSingle();
        if (!folder) return json({ error: "ismeretlen mappa — előbb manifeszt kell" }, 409);

        const slug = folderSlug(folderPath);
        const vaultPath = agentVaultPath(agent.id, slug, rel);

        let upstream: Response;
        try {
          upstream = await uploadToVault(vaultPath, request.body, {
            hash,
            mtime,
            contentLength: lengthHeader,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "ismeretlen hiba";
          await logAgentEvent("agent_upload_error", {
            ip: requestIp(request),
            tenantId: agent.tenant_id,
            agentId: agent.id,
            detail: { rel, message },
          });
          return json({ error: `a széf nem érhető el: ${message}` }, 502);
        }

        if (!upstream.ok) {
          const text = await upstream.text().catch(() => "");
          await logAgentEvent("agent_upload_error", {
            ip: requestIp(request),
            tenantId: agent.tenant_id,
            agentId: agent.id,
            detail: { rel, status: upstream.status, body: text.slice(0, 500) },
          });
          await supabaseAdmin
            .from("vault_agent_folders")
            .update({ last_error: `feltöltési hiba (${upstream.status})` })
            .eq("id", folder.id);
          return json({ error: "feltöltés sikertelen", detail: text.slice(0, 300) }, 502);
        }

        const written = (await upstream.json().catch(() => ({}))) as { size?: number };
        const now = new Date().toISOString();

        await supabaseAdmin.from("vault_agent_files").upsert(
          {
            agent_id: agent.id,
            folder_id: folder.id,
            rel,
            size: written.size ?? (Number.isFinite(size) ? size : 0),
            mtime: mtime && Number.isFinite(Number(mtime)) ? Number(mtime) : null,
            hash: hash ?? null,
            updated_at: now,
          },
          { onConflict: "folder_id,rel" },
        );

        await supabaseAdmin
          .from("vault_agent_folders")
          .update({ last_synced_at: now, last_error: null })
          .eq("id", folder.id);
        await supabaseAdmin.from("vault_agents").update({ last_seen_at: now }).eq("id", agent.id);

        return json({ ok: true, path: vaultPath });
      },
    },
  },
});
