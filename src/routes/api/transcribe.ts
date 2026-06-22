import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("multipart/form-data")) {
          return new Response(JSON.stringify({ error: "Expected multipart/form-data" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof File) || file.size < 256) {
          return new Response(
            JSON.stringify({ error: "A felvétel üres vagy túl rövid. Próbáld újra." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (file.size > 24 * 1024 * 1024) {
          return new Response(
            JSON.stringify({ error: "A felvétel túl nagy (max 24MB)." }),
            { status: 413, headers: { "Content-Type": "application/json" } },
          );
        }

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        upstream.append("file", file, file.name || "recording.webm");
        const lang = incoming.get("language");
        if (typeof lang === "string" && lang) upstream.append("language", lang);

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        const bodyText = await res.text();
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: `Transcription failed (${res.status}): ${bodyText.slice(0, 500)}` }),
            { status: res.status, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const json = JSON.parse(bodyText) as { text?: string };
          return new Response(JSON.stringify({ text: json.text ?? "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ text: bodyText }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
