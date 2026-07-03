// TOTP előnézet a UI-nak: visszaadja a workflow-hoz mentett TOTP secret
// aktuális 6-jegyű kódját + hátralévő másodperceket. Így a felhasználó
// azonnal ellenőrizheti, hogy jól írta-e be a secretet (matchel-e a
// Google Authenticator kódjával).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const previewTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("workflow_credentials")
      .select("totp_secret_ciphertext, totp_nonce")
      .eq("workflow_id", data.workflowId)
      .maybeSingle();
    if (!row?.totp_secret_ciphertext || !row.totp_nonce) {
      return { hasTotp: false as const };
    }
    const { decryptString } = await import("@/lib/credentials/crypto.server");
    const { generateTotp, secondsUntilNextTotp } = await import(
      "@/lib/credentials/totp.server"
    );
    const secret = await decryptString(row.totp_secret_ciphertext, row.totp_nonce);
    try {
      const code = generateTotp(secret);
      return {
        hasTotp: true as const,
        code,
        secondsRemaining: secondsUntilNextTotp(),
      };
    } catch (e) {
      return {
        hasTotp: true as const,
        error: e instanceof Error ? e.message : "TOTP hiba",
      };
    }
  });
