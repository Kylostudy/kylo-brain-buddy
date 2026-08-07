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
        let replyTo = msg?.reply_to_message?.message_id;
        const text = (msg?.text ?? "").trim();
        if (!text) return Response.json({ ok: true, ignored: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Ha NEM reply-ként írt (csak simán üzenetet küldött), akkor a legutóbbi
        // olyan értesítésre értjük, amire még nem válaszolt.
        let fellBack = false;
        if (!replyTo) {
          const { data: last } = await supabaseAdmin
            .from("telegram_outbox")
            .select("message_id")
            .eq("topic", "lead_alert")
            .is("reply_text", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!last?.message_id) return Response.json({ ok: true, ignored: true });
          replyTo = last.message_id as number;
          fellBack = true;
        }
        const { data: comment } = await supabaseAdmin
          .from("reddit_comments")
          .select("id, subreddit, author, context_title, suggested_reply_hu")
          .eq("telegram_message_id", replyTo)
          .maybeSingle();

        const { sendTelegram, translateToEnglish, translateToHungarian } = await import(
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
          const head = `${(out.platform ?? "rendszer").toString().toUpperCase()}${out.label ? ` · ${out.label}` : ""}${fellBack ? " (a legutóbbi értesítésre értettem)" : ""}`;

          // ---- Érdeklődés-radar találat: itt tényleg választ készítünk ----
          if (out.ref_table === "lead_alerts" && out.ref_id) {
            const { data: alert } = await supabaseAdmin
              .from("lead_alerts")
              .select("id, permalink, title_hu, title, suggested_reply_hu, suggested_reply_en")
              .eq("id", out.ref_id)
              .maybeSingle();


            if (alert) {
              if (SKIP_WORDS.has(text.toLowerCase())) {
                await supabaseAdmin
                  .from("lead_alerts")
                  .update({ status: "skipped" })
                  .eq("id", alert.id);
                await sendTelegram(`Rendben, ezt kihagyjuk — ${head}`, {
                  topic: "lead_alert_ack",
                  platform: out.platform,
                  ref_table: out.ref_table,
                  ref_id: out.ref_id,
                  label: out.label,
                });
                return Response.json({ ok: true, action: "skipped" });
              }

              if (looksLikeQuestion(text) && !isAccept(text)) {
                await sendTelegram(
                  [
                    `❓ Ezt kérdésnek értem, ezért NEM mentettem el válaszvázlatként — ${head}`,
                    alert.title_hu ? `Poszt: ${alert.title_hu}` : "",
                    alert.permalink ?? "",
                    ``,
                    `Ha mégis ezt küldenéd ki válaszként, írd elé, hogy „válasz:”.`,
                    `Ha jó a javaslatom, elég annyi: „mehet”.`,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  {
                    topic: "lead_alert_ack",
                    platform: out.platform,
                    ref_table: out.ref_table,
                    ref_id: out.ref_id,
                    label: out.label,
                  },
                );
                return Response.json({ ok: true, action: "question" });
              }

              const accepted = isAccept(text);
              // Régi találatoknál csak angol javaslat van — ilyenkor magyarra fordítjuk.
              let suggestedHu = alert.suggested_reply_hu ?? "";
              if (accepted && !suggestedHu.trim() && alert.suggested_reply_en) {
                suggestedHu = (await translateToHungarian(alert.suggested_reply_en)) || "";
              }
              const hungarian = accepted
                ? suggestedHu
                : text.replace(/^v[áa]lasz:\s*/i, "");

              if (!hungarian.trim()) {
                await sendTelegram(
                  `Nincs mit lefordítanom (nem találom a javasolt választ) — ${head}. Írd le magyarul, mit válaszoljak.`,
                );
                return Response.json({ ok: true, action: "empty" });
              }

              const english = accepted && alert.suggested_reply_en
                ? alert.suggested_reply_en
                : (await translateToEnglish(hungarian)) || hungarian;
              const { error: saveError } = await supabaseAdmin
                .from("lead_alerts")
                .update({
                  approved_reply_hu: hungarian,
                  approved_reply_en: english,
                  approved_at: new Date().toISOString(),
                  status: "approved",
                })
                .eq("id", alert.id);
              if (saveError) {
                await sendTelegram(
                  `⚠️ Nem sikerült elmenteni a jóváhagyást — ${head}: ${saveError.message}`,
                );
                return Response.json({ ok: false, error: saveError.message });
              }


              await sendTelegram(
                [
                  `✅ ${accepted ? "A javasolt választ fogadtad el" : "A saját szövegedet mentettem el"} — ${head}`,
                  alert.title_hu ? `Poszt: ${alert.title_hu}` : "",
                  alert.permalink ?? "",
                  ``,
                  `MAGYARUL:`,
                  hungarian,
                  ``,
                  `ANGOLUL (ezt lehet kimásolni Redditre):`,
                  english,
                ]
                  .filter(Boolean)
                  .join("\n"),
                {
                  topic: "lead_alert_ack",
                  platform: out.platform,
                  ref_table: out.ref_table,
                  ref_id: out.ref_id,
                  label: out.label,
                  payload: p,
                },
              );
              return Response.json({ ok: true, action: "approved" });
            }
          }

          // ---- LinkedIn hozzászólás / értesítés ----
          if (out.ref_table === "linkedin_comments" && out.ref_id) {
            const { data: li } = await supabaseAdmin
              .from("linkedin_comments")
              .select(
                "id, permalink, context_title, author, body_hu, suggested_reply_hu, suggested_reply_en",
              )
              .eq("id", out.ref_id)
              .maybeSingle();

            if (li) {
              if (SKIP_WORDS.has(text.toLowerCase())) {
                await supabaseAdmin
                  .from("linkedin_comments")
                  .update({ reply_status: "skipped", needs_reply: false })
                  .eq("id", li.id);
                await sendTelegram(`Rendben, ezt kihagyjuk — ${head}`, {
                  topic: "linkedin_comment_ack",
                  platform: "linkedin",
                  ref_table: out.ref_table,
                  ref_id: out.ref_id,
                  label: out.label,
                });
                return Response.json({ ok: true, action: "skipped" });
              }

              if (looksLikeQuestion(text) && !isAccept(text)) {
                await sendTelegram(
                  [
                    `❓ Ezt kérdésnek értem, ezért NEM mentettem el válaszvázlatként — ${head}`,
                    li.context_title ? `Poszt: ${li.context_title}` : "",
                    li.permalink ?? "",
                    ``,
                    `Ha mégis ezt küldenéd ki válaszként, írd elé, hogy „válasz:”.`,
                    `Ha jó a javaslatom, elég annyi: „mehet”.`,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  {
                    topic: "linkedin_comment_ack",
                    platform: "linkedin",
                    ref_table: out.ref_table,
                    ref_id: out.ref_id,
                    label: out.label,
                  },
                );
                return Response.json({ ok: true, action: "question" });
              }

              const accepted = isAccept(text);
              let suggestedHu = li.suggested_reply_hu ?? "";
              if (accepted && !suggestedHu.trim() && li.suggested_reply_en) {
                suggestedHu = (await translateToHungarian(li.suggested_reply_en)) || "";
              }
              const hungarian = accepted ? suggestedHu : text.replace(/^v[áa]lasz:\s*/i, "");

              if (!hungarian.trim()) {
                await sendTelegram(
                  `Nincs mit lefordítanom (nem találom a javasolt választ) — ${head}. Írd le magyarul, mit válaszoljak.`,
                );
                return Response.json({ ok: true, action: "empty" });
              }

              const english =
                accepted && li.suggested_reply_en
                  ? li.suggested_reply_en
                  : (await translateToEnglish(hungarian)) || hungarian;

              const { error: saveError } = await supabaseAdmin
                .from("linkedin_comments")
                .update({
                  approved_reply_hu: hungarian,
                  approved_reply_en: english,
                  approved_at: new Date().toISOString(),
                  reply_status: "approved",
                })
                .eq("id", li.id);
              if (saveError) {
                await sendTelegram(
                  `⚠️ Nem sikerült elmenteni a jóváhagyást — ${head}: ${saveError.message}`,
                );
                return Response.json({ ok: false, error: saveError.message });
              }

              await sendTelegram(
                [
                  `✅ ${accepted ? "A javasolt választ fogadtad el" : "A saját szövegedet mentettem el"} — ${head}`,
                  li.context_title ? `Poszt: ${li.context_title}` : "",
                  li.author ? `Kinek: ${li.author}` : "",
                  li.permalink ?? "",
                  ``,
                  `MAGYARUL:`,
                  hungarian,
                  ``,
                  `ANGOLUL (ezt lehet kimásolni LinkedInre):`,
                  english,
                ]
                  .filter(Boolean)
                  .join("\n"),
                {
                  topic: "linkedin_comment_ack",
                  platform: "linkedin",
                  ref_table: out.ref_table,
                  ref_id: out.ref_id,
                  label: out.label,
                  payload: p,
                },
              );
              return Response.json({ ok: true, action: "approved" });
            }
          }



          await sendTelegram(
            [
              `📌 Megvan, mire válaszoltál: ${head}`,
              typeof p.title === "string" && p.title ? `Cím: ${p.title}` : "",
              typeof p.url === "string" && p.url ? `Link: ${p.url}` : "",
              ``,
              `Ez az üzenet nem válasz-javaslat volt, ezért csak feljegyeztem, amit írtál:`,
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

        if (looksLikeQuestion(text) && !isAccept(text)) {
          await sendTelegram(
            [
              `❓ Ezt kérdésnek értem, ezért NEM mentettem el válaszként — ${tag}`,
              comment.context_title ? `Poszt: ${comment.context_title}` : "",
              ``,
              `Ha mégis ezt küldenéd ki, írd elé: „válasz:”. Ha jó a javaslatom: „mehet”.`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return Response.json({ ok: true, action: "question" });
        }

        const accepted = isAccept(text);
        const hungarian = accepted
          ? (comment.suggested_reply_hu ?? "")
          : text.replace(/^v[áa]lasz:\s*/i, "");

        if (!hungarian.trim()) {
          await sendTelegram(
            `Nincs mit lefordítanom (nem találom a javasolt választ) — ${tag}. Írd le magyarul, mit válaszoljak.`,
          );
          return Response.json({ ok: true, action: "empty" });
        }

        const english = (await translateToEnglish(hungarian)) || hungarian;
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
            `✅ ${accepted ? "A javasolt választ fogadtad el" : "Válasz elmentve"} — ${tag}`,
            comment.context_title ? `Poszt: ${comment.context_title}` : "",
            ``,
            `MAGYARUL:`,
            hungarian,
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
