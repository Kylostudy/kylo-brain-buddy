// Monitor dispatch — utófeldolgozás a workflow_runs.complete után.
// Most: Decathlon stockfigyelő → Telegram értesítés állapotváltozáskor.
// A logika idempotens: csak akkor küld üzenetet, ha az előző futáshoz képest
// változott az "available" érték (false → true vagy true → false).

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type StockResult = {
  available?: boolean;
  size?: string;
  url?: string;
  productName?: string;
};

function sb() {
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

export async function handleRunCompletion(runId: string): Promise<void> {
  const { data: run } = await sb()
    .from("brain_workflow_runs")
    .select("id, workflow_id, status, result, spec_snapshot, finished_at")
    .eq("id", runId)
    .maybeSingle();

  if (!run || run.status !== "succeeded") return;

  const spec = (run.spec_snapshot ?? {}) as Record<string, unknown>;
  const monitorType = (spec.monitor_type ?? spec.platform) as string | undefined;
  if (monitorType !== "decathlon-stock") return;

  const result = (run.result ?? null) as StockResult | null;
  if (!result || typeof result.available !== "boolean") return;

  // Előző sikeres futás eredménye ugyanahhoz a workflow-hoz
  const { data: prev } = await sb()
    .from("brain_workflow_runs")
    .select("result")
    .eq("workflow_id", run.workflow_id)
    .eq("status", "succeeded")
    .neq("id", run.id)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevAvailable =
    prev && (prev.result as StockResult | null)?.available === true;
  const nowAvailable = result.available === true;

  // Csak állapotváltozáskor küldjünk
  if (prevAvailable === nowAvailable) return;

  if (nowAvailable) {
    const productName = result.productName ?? "termék";
    const size = result.size ?? "kért méret";
    const url = result.url ?? "";
    const text = `🟢 Decathlon: kapható ${size} ${productName}!\n${url}\n\nMenj és vedd meg!`;
    await sendTelegram(text);
  } else {
    // opcionális: el is mondhatjuk, hogy újra elfogyott
    const productName = result.productName ?? "termék";
    const size = result.size ?? "kért méret";
    await sendTelegram(`🔴 Decathlon: ${size} ${productName} ismét elfogyott.`);
  }
}

async function sendTelegram(text: string): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!lovableKey || !telegramKey || !chatId) {
    console.warn(
      "Telegram értesítés átugorva: TELEGRAM_API_KEY vagy TELEGRAM_CHAT_ID hiányzik.",
    );
    return;
  }
  const res = await fetch(
    "https://connector-gateway.lovable.dev/telegram/sendMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": telegramKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    },
  );
  if (!res.ok) {
    console.error("Telegram sendMessage hiba", res.status, await res.text());
  }
}
