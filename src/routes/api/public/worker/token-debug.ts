// Ideiglenes diagnosztika: visszaadja a szerveren tárolt WORKER_API_TOKEN
// hosszát és MD5 hash-ét (a tokent magát NEM). Csak hibakereséshez.
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/public/worker/token-debug")({
  server: {
    handlers: {
      GET: async () => {
        const t = process.env.WORKER_API_TOKEN ?? "";
        const md5 = createHash("md5").update(t).digest("hex");
        return new Response(
          JSON.stringify({ length: t.length, md5, present: t.length > 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
