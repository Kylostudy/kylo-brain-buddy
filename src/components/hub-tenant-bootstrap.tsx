/**
 * Fire-and-forget client bootstrap that ensures the signed-in user has a
 * Hub-issued tenant_id. Mounted once in the root layout. Never blocks UI.
 */

import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { ensureTenantRegistered } from "@/lib/hub.functions";

export function HubTenantBootstrap() {
  const ensure = useServerFn(ensureTenantRegistered);
  const ranForUser = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = (userId: string) => {
      if (ranForUser.current === userId) return;
      ranForUser.current = userId;
      // Fire-and-forget: log failures, never throw.
      ensure({})
        .then((res) => {
          if (cancelled) return;
          if (!res.ok) {
            console.warn("[Hub] ensureTenantRegistered failed:", res.error);
          } else if (!res.cached) {
            console.info("[Hub] tenant registered:", res.tenant_id);
          }
        })
        .catch((err) => {
          console.warn("[Hub] ensureTenantRegistered threw:", err);
        });
    };

    // Initial check.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user) run(data.session.user.id);
    });

    // Re-run on sign-in.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        ranForUser.current = null;
        return;
      }
      if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        session?.user
      ) {
        run(session.user.id);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [ensure]);

  return null;
}
