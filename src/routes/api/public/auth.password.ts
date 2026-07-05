import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const Route = createFileRoute("/api/public/auth/password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = passwordLoginSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { error: "Hibás e-mail vagy jelszó formátum." },
            { status: 400 },
          );
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !publishableKey) {
          return Response.json(
            { error: "A beléptetési háttér nincs megfelelően beállítva." },
            { status: 500 },
          );
        }

        const supabase = createClient<Database>(supabaseUrl, publishableKey, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error || !data.session) {
          return Response.json(
            { error: error?.message ?? "Sikertelen bejelentkezés." },
            { status: 401 },
          );
        }

        return Response.json({ session: data.session });
      },
    },
  },
});