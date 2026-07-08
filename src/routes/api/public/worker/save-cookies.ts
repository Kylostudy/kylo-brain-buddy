// Worker cookie mentés végpont — a recorder VPS worker hívja, amikor a
// felhasználó a modálon a "Sütik mentése workflow-ba" gombot megnyomja.
// A worker POST-ol egy {sessionId, cookies} payloadot, mi kikeressük a
// hozzá tartozó workflow-t és titkosítva beírjuk a workflow_credentials
// cookie_ciphertext / cookie_nonce mezőibe.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token
// Válasz: 200 { savedCount, platform } | 4xx { error }

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ??
        request.headers.get("x-api-key") ??
        ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const CookieSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(8192),
  domain: z.string().max(256).optional(),
  path: z.string().max(1024).optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.string().max(16).optional(),
});

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  cookies: z.array(CookieSchema).min(1).max(1000),
});

// Minimum elvárt kritikus süti nevek platformonként. Ha ezek egyike sincs meg,
// a session valószínűleg nincs bejelentkezve — hibát adunk, hogy a
// felhasználó tudja, még nem elég.
const REQUIRED_COOKIES: Record<string, string[]> = {
  linkedin: ["li_at"],
  tiktok: ["sessionid"],
  pinterest: ["_pinterest_sess"],
  instagram: ["sessionid"],
  facebook: ["c_user", "xs"],
  x: ["auth_token"],
  twitter: ["auth_token"],
};

function hasRequiredCookies(platform: string | null, cookies: { name: string }[]): boolean {
  const req = REQUIRED_COOKIES[(platform || "").toLowerCase()];
  if (!req || req.length === 0) return true; // ismeretlen platform: engedjük
  const names = new Set(cookies.map((c) => c.name));
  return req.some((r) => names.has(r));
}

export const Route = createFileRoute("/api/public/worker/save-cookies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const parsed = BodySchema.safeParse(json);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "invalid body", details: parsed.error.flatten() }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { sessionId, cookies } = parsed.data;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        // Session → workflow → tenant + platform
        const { data: session, error: sErr } = await sb
          .from("recording_sessions")
          .select("id, workflow_id, tenant_id")
          .eq("id", sessionId)
          .maybeSingle();
        if (sErr || !session) {
          return new Response(
            JSON.stringify({ error: "session not found" }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }

        const { data: wf, error: wErr } = await sb
          .from("workflows")
          .select("id, tenant_id, platform")
          .eq("id", session.workflow_id)
          .maybeSingle();
        if (wErr || !wf) {
          return new Response(
            JSON.stringify({ error: "workflow not found" }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }

        if (!hasRequiredCookies(wf.platform, cookies)) {
          const req = REQUIRED_COOKIES[(wf.platform || "").toLowerCase()] || [];
          return new Response(
            JSON.stringify({
              error: `hiányzik a bejelentkezési süti (${req.join(", ")}). A session valószínűleg nincs bejelentkezve — jelentkezz be előbb a recorder böngészőjében.`,
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        // Titkosítás
        const { encryptString } = await import("@/lib/credentials/crypto.server");
        const cookiesJson = JSON.stringify(cookies);
        const { ciphertext, nonce } = await encryptString(cookiesJson);

        // Upsert workflow_credentials — platformonként külön sor.
        // Egy workflow-hoz több platform is tartozhat (pl. gmail + pinterest),
        // ezért (workflow_id, platform) párra keresünk, nem csak workflow_id-ra.
        // Enélkül a Pinterest sütik felülírnák a Gmail sor cookie mezőit, és
        // a platform oszlop hibásan "gmail" maradna.
        const platformKey = (wf.platform || "unknown").toLowerCase();
        const { data: existing } = await sb
          .from("workflow_credentials")
          .select("id")
          .eq("workflow_id", wf.id)
          .eq("platform", platformKey)
          .maybeSingle();

        const nowIso = new Date().toISOString();
        if (existing) {
          const { error: upErr } = await sb
            .from("workflow_credentials")
            .update({
              cookie_ciphertext: ciphertext,
              cookie_nonce: nonce,
              updated_at: nowIso,
            })
            .eq("id", existing.id);
          if (upErr) {
            return new Response(JSON.stringify({ error: upErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
        } else {
          const { error: insErr } = await sb.from("workflow_credentials").insert({
            workflow_id: wf.id,
            tenant_id: wf.tenant_id,
            platform: platformKey,
            cookie_ciphertext: ciphertext,
            cookie_nonce: nonce,
          });
          if (insErr) {
            return new Response(JSON.stringify({ error: insErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            savedCount: cookies.length,
            platform: wf.platform,
            workflowId: wf.id,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
