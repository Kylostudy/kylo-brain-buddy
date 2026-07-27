import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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

        const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: publishableKey,
          },
          body: JSON.stringify(parsed.data),
        });

        const payload = await authResponse.json().catch(() => null) as
          | {
              access_token?: string;
              refresh_token?: string;
              expires_at?: number;
              expires_in?: number;
              user?: unknown;
              msg?: string;
              error_description?: string;
              error?: string;
            }
          | null;

        if (!authResponse.ok || !payload?.access_token || !payload.refresh_token || !payload.user) {
          const message = payload?.msg || payload?.error_description || payload?.error || "Sikertelen bejelentkezés.";
          return Response.json(
            { error: message },
            { status: authResponse.status === 400 ? 401 : authResponse.status },
          );
        }

        return Response.json({
          session: {
            ...payload,
            expires_at: payload.expires_at ?? Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
          },
        });
      },
    },
  },
});