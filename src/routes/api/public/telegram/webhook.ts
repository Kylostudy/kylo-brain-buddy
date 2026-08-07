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

const SKIP_WORDS = new Set([
  "nem",
  "skip",
  "-",
  "kihagy",
  "nem kell",
  "x",
  "hagyd",
  "hagyjuk",
  "nem kell válasz",
]);

// „Mehet az ajánlott válasz” típusú jóváhagyások: ilyenkor NEM ezt a mondatot
// fordítjuk le, hanem a rendszer által javasolt választ küldjük tovább.
const ACCEPT_RE =
  /^(ok(é|e)?|okay|rendben|mehet|jó|jo|jöhet|johet|igen|küldd|kuldd|elfogadom|tetszik|passzol|szuper|tökéletes|tokeletes|\+1|👍|✅)\b/i;

function isAccept(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 60) return false;
  return ACCEPT_RE.test(t) || /^mehet az aj[áa]nlott/i.test(t);
}

// Kérdés-szerű válasz: ilyenkor ne mentsünk el semmit válaszvázlatként.
function looksLikeQuestion(text: string): boolean {
  return text.trim().endsWith("?") && text.trim().length < 200;
}


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
          .select("id, subreddit, author, context_title")
          .eq("telegram_message_id", replyTo)
          .maybeSingle();

        const { sendTelegram, translateToEnglish } = await import(
          "@/lib/reddit-post-patrol.server"
        );

        if (!comment) {
          // Nem komment-értesítés: nézzük meg az általános üzenet-naplóban,
          // hogy melyik posztról / platformról szólt az eredeti üzenet.
          const { data: out } = await supabaseAdmin
            .from("telegram_outbox")
            .select("id, topic, platform, ref_table, ref_id, label, payload")
            .eq("message_id", replyTo)
            .maybeSingle();

          if (!out) {
            await sendTelegram(
              "Nem találom, melyik üzenetre válaszoltál (régi vagy nem a rendszertől jött). Válaszolj közvetlenül egy friss értesítésre.",
            );
            return Response.json({ ok: true, matched: false });
          }

          await supabaseAdmin
            .from("telegram_outbox")
            .update({ reply_text: text, replied_at: new Date().toISOString() })
            .eq("id", out.id);

          const p = (out.payload ?? {}) as Record<string, unknown>;
          const head = `${(out.platform ?? "rendszer").toString().toUpperCase()}${out.label ? ` · ${out.label}` : ""}`;
          await sendTelegram(
            [
              `📌 Megvan, mire válaszoltál: ${head}`,
              typeof p.title === "string" && p.title ? `Cím: ${p.title}` : "",
              typeof p.url === "string" && p.url ? `Link: ${p.url}` : "",
              ``,
              `A válaszodat elmentettem ehhez az ügyhöz:`,
              text,
            ]
              .filter(Boolean)
              .join("\n"),
            {
              topic: `${out.topic}_ack`,
              platform: out.platform,
              ref_table: out.ref_table,
              ref_id: out.ref_id,
              label: out.label,
              payload: p,
            },
          );
          return Response.json({ ok: true, matched: true, topic: out.topic });
        }


        const tag = `REDDIT · r/${comment.subreddit ?? "?"} · u/${comment.author ?? "?"}`;

        if (SKIP_WORDS.has(text.toLowerCase())) {
          await supabaseAdmin
            .from("reddit_comments")
            .update({ reply_status: "ignored" })
            .eq("id", comment.id);
          await sendTelegram(`Rendben, kihagyjuk — ${tag}`);
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
            `✅ Válasz elmentve — ${tag}`,
            comment.context_title ? `Poszt: ${comment.context_title}` : "",
            ``,
            `ANGOL VÁLTOZAT:`,
            english,
            ``,
            `A Tartalom Stúdióban tudod kiküldeni a workflow-nak.`,
          ]
            .filter(Boolean)
            .join("\n"),
        );


        return Response.json({ ok: true, action: "approved" });
      },
    },
  },
});
