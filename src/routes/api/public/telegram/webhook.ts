// Telegram webhook — a Poszt-őrjárat üzeneteire adott válaszaidat dolgozza fel.
//
// Ha VÁLASZOLSZ (reply) egy kiküldött komment-értesítésre:
//  - "nem" / "skip" / "-"  => a komment figyelmen kívül hagyva
//  - bármi más magyar szöveg => lefordítjuk angolra, elmentjük jóváhagyott válaszként
//
// Biztonság: X-Telegram-Bot-Api-Secret-Token, a TELEGRAM_API_KEY-ből származtatva.
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

function deriveSecret(telegramApiKey: string): string {
  return createHash("sha256")
    .update(`telegram-webhook:${telegramApiKey}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const SKIP_WORDS = new Set(["nem", "skip", "-", "kihagy", "nem kell", "x"]);

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const telegramKey = process.env.TELEGRAM_API_KEY;
        if (!telegramKey) return new Response("Not configured", { status: 503 });

        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, deriveSecret(telegramKey))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json()) as {
          message?: {
            text?: string;
            chat?: { id?: number };
            reply_to_message?: { message_id?: number };
          };
        };
        const msg = update.message;
        const replyTo = msg?.reply_to_message?.message_id;
        const text = (msg?.text ?? "").trim();
        if (!replyTo || !text) return Response.json({ ok: true, ignored: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: comment } = await supabaseAdmin
          .from("reddit_comments")
          .select("id, subreddit, author")
          .eq("telegram_message_id", replyTo)
          .maybeSingle();

        const { sendTelegram, translateToEnglish } = await import(
          "@/lib/reddit-post-patrol.server"
        );

        if (!comment) {
          await sendTelegram("Nem találom, melyik kommentre válaszoltál. Válaszolj közvetlenül az értesítő üzenetre.");
          return Response.json({ ok: true, matched: false });
        }

        if (SKIP_WORDS.has(text.toLowerCase())) {
          await supabaseAdmin
            .from("reddit_comments")
            .update({ reply_status: "ignored" })
            .eq("id", comment.id);
          await sendTelegram("Rendben, ezt a kommentet kihagyjuk.");
          return Response.json({ ok: true, action: "ignored" });
        }

        const english = (await translateToEnglish(text)) || text;
        await supabaseAdmin
          .from("reddit_comments")
          .update({
            approved_reply_en: english,
            approved_at: new Date().toISOString(),
            reply_status: "approved",
          })
          .eq("id", comment.id);

        await sendTelegram(
          [
            `✅ Válasz elmentve — u/${comment.author ?? "?"} (r/${comment.subreddit ?? "?"})`,
            ``,
            `ANGOL VÁLTOZAT:`,
            english,
            ``,
            `A Tartalom Stúdióban tudod kiküldeni a workflow-nak.`,
          ].join("\n"),
        );

        return Response.json({ ok: true, action: "approved" });
      },
    },
  },
});
