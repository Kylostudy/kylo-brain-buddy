/**
 * GET /api/public/cross/kylogic/workflows
 *
 * Sync endpoint for Kylogic → Brain workflow inventory (filtered-mode).
 * Kylogic polls this to learn which workflows exist per tenant, so it can
 * dispatch `publish_video` tasks by (language, region, platform) filter
 * instead of hard-coded UUIDs.
 *
 * - HMAC verified with BRAIN_KYLOGIC_TASK_SECRET (±5 min, peer "kylogic").
 * - 5 minute in-memory cache per tenant (worker-local).
 * - Optional filters: ?tenant_id=&platform=&language=&region=&active=1
 * - Returns only workflows in module='brain'.
 */

import { createFileRoute } from "@tanstack/react-router";

import { verifyKylogicTaskRequest } from "@/lib/kylogic-bridge.server";

const ROUTE_PATH = "/api/public/cross/kylogic/workflows";
const CACHE_TTL_MS = 5 * 60 * 1000;

type WorkflowRow = {
  id: string;
  tenant_id: string;
  name: string;
  platform: string | null;
  language: string | null;
  region: string | null;
  timezone: string | null;
  daily_cap: number;
  active: boolean;
  status: string;
  ready_for_test: boolean;
  updated_at: string;
};

type CacheEntry = { at: number; payload: string };
const cache = new Map<string, CacheEntry>();

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cacheKey(u: URL): string {
  const q = u.searchParams;
  return [
    q.get("tenant_id") ?? "",
    q.get("platform") ?? "",
    q.get("language") ?? "",
    q.get("region") ?? "",
    q.get("active") ?? "",
  ].join("|");
}

export const Route = createFileRoute("/api/public/cross/kylogic/workflows")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const pathWithQuery = `${url.pathname}${url.search}`;

        const verify = verifyKylogicTaskRequest(
          "GET",
          pathWithQuery,
          "",
          request.headers,
        );
        if (!verify.ok) {
          return jsonError(verify.status, verify.reason);
        }

        const key = cacheKey(url);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_TTL_MS) {
          return new Response(hit.payload, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Cache": "HIT",
              "Cache-Control": "private, max-age=300",
            },
          });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        let query = supabaseAdmin
          .from("workflows")
          .select(
            "id, tenant_id, name, platform, language, region, timezone, daily_cap, active, status, ready_for_test, updated_at",
          )
          .eq("module", "brain");

        const tenantId = url.searchParams.get("tenant_id");
        const platform = url.searchParams.get("platform");
        const language = url.searchParams.get("language");
        const region = url.searchParams.get("region");
        const activeParam = url.searchParams.get("active");

        if (tenantId) query = query.eq("tenant_id", tenantId);
        if (platform) query = query.eq("platform", platform);
        if (language) query = query.eq("language", language);
        if (region) query = query.eq("region", region);
        if (activeParam === "1" || activeParam === "true") {
          query = query.eq("active", true);
        }

        const { data, error } = await query.order("updated_at", {
          ascending: false,
        });

        if (error) {
          console.error("[Kylogic←Brain] workflows sync failed", error);
          if (hit) {
            // Stale fallback if we have anything cached.
            return new Response(hit.payload, {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-Cache": "STALE",
              },
            });
          }
          return jsonError(500, "Failed to query workflows");
        }

        const rows: WorkflowRow[] = (data ?? []) as WorkflowRow[];
        const payload = JSON.stringify({
          ok: true,
          count: rows.length,
          generated_at: new Date().toISOString(),
          cache_ttl_seconds: CACHE_TTL_MS / 1000,
          workflows: rows.map((r) => ({
            id: r.id,
            tenant_id: r.tenant_id,
            name: r.name,
            platform: r.platform,
            language: r.language,
            region: r.region,
            timezone: r.timezone,
            daily_cap: r.daily_cap,
            active: r.active,
            status: r.status,
            ready_for_test: r.ready_for_test,
            updated_at: r.updated_at,
          })),
        });

        cache.set(key, { at: now, payload });

        return new Response(payload, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Cache": "MISS",
            "Cache-Control": "private, max-age=300",
          },
        });
      },
    },
  },
});

// Suppress unused warning: ROUTE_PATH kept for docs/reference.
void ROUTE_PATH;
