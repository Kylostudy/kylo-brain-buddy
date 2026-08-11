/**
 * Felderítő járat (UI recon) — szerver-oldali feldolgozás.
 *
 * A worker képernyőfotót + DOM-kivonatot küld. Itt:
 *   1. eltároljuk a fotót és a mérést,
 *   2. Gemini Visionnel megkerestetjük a kért fogódzókat (szelektorokat),
 *   3. a magabiztos találatokat betanítjuk a worker_learned_selectors táblába,
 *   4. ha a felület megváltozott az előző járathoz képest, Telegramon szólunk.
 */

const CONFIDENCE_MIN = 0.8;

export type ReconField = { name: string; description: string };

export type ReconIngestInput = {
  platform: string;
  pageType: string;
  url: string;
  screenshotB64: string;
  mimeType: "image/png" | "image/jpeg";
  domDigest: Record<string, unknown>;
  fields: ReconField[];
  workflowId?: string | null;
  runId?: string | null;
  taskId?: string | null;
};

export type ReconProposal = {
  field: string;
  selector: string | null;
  confidence: number;
  reason?: string;
};

export type ReconIngestResult = {
  snapshotId: string | null;
  learned: ReconProposal[];
  proposals: ReconProposal[];
  changed: boolean;
  changeNote: string | null;
};

async function sendTelegram(text: string): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!lovableKey || !telegramKey || !chatId) return;
  try {
    const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": telegramKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("Telegram hiba", res.status, await res.text());
  } catch (e) {
    console.error("Telegram kivétel", e);
  }
}

function buildPrompt(input: ReconIngestInput): string {
  const list = input.fields
    .map((f, i) => `${i + 1}. ${f.name} — ${f.description}`)
    .join("\n");
  return [
    `Ez egy ${input.platform} oldal képernyőfotója (${input.pageType}), URL: ${input.url}.`,
    "",
    "A képen látható felülethez CSS/Playwright szelektorokat kell javasolnod az alábbi elemekre:",
    list,
    "",
    "A DOM-kivonat (látható gombok feliratai, aria-label és data-* attribútumok):",
    JSON.stringify(input.domDigest).slice(0, 12000),
    "",
    "Szabályok:",
    "- CSAK olyan szelektort adj, ami a DOM-kivonatban ténylegesen szerepel (aria-label, osztálynév, felirat).",
    "- Playwright-kompatibilis szintaxis megengedett, pl. button:has-text(\"Post\").",
    "- Ha egy elem nem látszik a képen, selector legyen null és confidence 0.",
    "- confidence: 0 és 1 közötti szám.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          selector: { type: ["string", "null"] },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["field", "selector", "confidence"],
        additionalProperties: false,
      },
    },
    layout_summary: { type: "string" },
  },
  required: ["proposals", "layout_summary"],
  additionalProperties: false,
} as const;

async function askGemini(input: ReconIngestInput): Promise<{
  proposals: ReconProposal[];
  layoutSummary: string;
}> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY nincs beállítva");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "Felület-felderítő vagy: képernyőfotóból és DOM-kivonatból stabil szelektorokat javasolsz. Csak a kért JSON-t add vissza.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(input) },
            {
              type: "image_url",
              image_url: { url: `data:${input.mimeType};base64,${input.screenshotB64}` },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "ui_recon", strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: { proposals?: ReconProposal[]; layout_summary?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return {
    proposals: (parsed.proposals ?? []).filter((p) => p && typeof p.field === "string"),
    layoutSummary: parsed.layout_summary ?? "",
  };
}

export async function processReconSnapshot(
  input: ReconIngestInput,
): Promise<ReconIngestResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Tenant feloldás a workflow alapján (a worker mindig küld workflow_id-t).
  let tenantId: string | null = null;
  let workflowId: string | null = input.workflowId ?? null;
  if (workflowId) {
    const { data } = await supabaseAdmin
      .from("workflows")
      .select("tenant_id")
      .eq("id", workflowId)
      .maybeSingle();
    tenantId = (data?.tenant_id as string | undefined) ?? null;
  }
  // Tartalék: a feladat azonosítójából (a worker spec-je nem mindig hoz workflow_id-t).
  if (!tenantId && input.taskId) {
    const { data } = await supabaseAdmin
      .from("brain_task_queue")
      .select("tenant_id, workflow_id")
      .eq("id", input.taskId)
      .maybeSingle();
    tenantId = (data?.tenant_id as string | undefined) ?? null;
    workflowId = workflowId ?? ((data?.workflow_id as string | undefined) ?? null);
  }
  // Tartalék 2: a futás rekordjából.
  if (!tenantId && input.runId) {
    const { data } = await supabaseAdmin
      .from("brain_workflow_runs")
      .select("tenant_id, workflow_id")
      .eq("id", input.runId)
      .maybeSingle();
    tenantId = (data?.tenant_id as string | undefined) ?? null;
    workflowId = workflowId ?? ((data?.workflow_id as string | undefined) ?? null);
  }
  if (!tenantId) throw new Error("Nem sikerült tenantot feloldani a workflow alapján.");

  // 1. Fotó feltöltése
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = input.mimeType === "image/png" ? "png" : "jpg";
  const path = `${tenantId}/${input.platform}/${input.pageType}/${stamp}.${ext}`;
  const bytes = Buffer.from(input.screenshotB64, "base64");
  const { error: upErr } = await supabaseAdmin.storage
    .from("ui-recon-shots")
    .upload(path, bytes, { contentType: input.mimeType, upsert: true });
  if (upErr) console.error("Recon fotó feltöltés hiba:", upErr.message);

  // 2. Gemini elemzés
  let proposals: ReconProposal[] = [];
  let layoutSummary = "";
  let analysisError: string | null = null;
  try {
    const out = await askGemini(input);
    proposals = out.proposals;
    layoutSummary = out.layoutSummary;
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
    console.error("Recon elemzés hiba:", analysisError);
  }

  // 3. Tanulás — csak a magabiztos találatok
  const learned: ReconProposal[] = [];
  for (const p of proposals) {
    if (!p.selector || (p.confidence ?? 0) < CONFIDENCE_MIN) continue;
    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("worker_learned_selectors")
      .select("id, selector")
      .eq("platform", input.platform)
      .eq("page_type", input.pageType)
      .eq("field", p.field)
      .maybeSingle();

    if (existing) {
      if (existing.selector !== p.selector) {
        await supabaseAdmin
          .from("worker_learned_selectors")
          .update({
            selector: p.selector,
            learned_from: "gemini_vision",
            success_count: 0,
            fail_count: 0,
            last_verified_at: now,
            notes: p.reason?.slice(0, 500) ?? null,
          })
          .eq("id", existing.id);
        learned.push(p);
      }
    } else {
      await supabaseAdmin.from("worker_learned_selectors").insert({
        platform: input.platform,
        page_type: input.pageType,
        field: p.field,
        selector: p.selector,
        learned_from: "gemini_vision",
        success_count: 0,
        fail_count: 0,
        last_verified_at: now,
        notes: p.reason?.slice(0, 500) ?? null,
      });
      learned.push(p);
    }
  }

  // 4. Változás-figyelés az előző járathoz képest
  const { data: prev } = await supabaseAdmin
    .from("ui_recon_snapshots")
    .select("analysis, dom_digest")
    .eq("tenant_id", tenantId)
    .eq("platform", input.platform)
    .eq("page_type", input.pageType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevLabels = new Set(
    ((prev?.dom_digest as { buttons?: string[] } | null)?.buttons ?? []).map(String),
  );
  const nowLabels = new Set(
    ((input.domDigest as { buttons?: string[] }).buttons ?? []).map(String),
  );
  const gone = [...prevLabels].filter((l) => !nowLabels.has(l));
  const appeared = [...nowLabels].filter((l) => !prevLabels.has(l));
  const changed = prev ? gone.length + appeared.length >= 3 || learned.length > 0 : false;
  const changeNote = changed
    ? `Eltűnt: ${gone.slice(0, 6).join(", ") || "—"} · Új: ${appeared.slice(0, 6).join(", ") || "—"}`
    : null;

  // 5. Mentés
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("ui_recon_snapshots")
    .insert({
      tenant_id: tenantId,
      workflow_id: input.workflowId ?? null,
      run_id: input.runId ?? null,
      platform: input.platform,
      page_type: input.pageType,
      url: input.url,
      screenshot_path: upErr ? null : path,
      dom_digest: input.domDigest as never,
      analysis: {
        layout_summary: layoutSummary,
        proposals,
        error: analysisError,
      } as never,
      learned_fields: learned.map((l) => l.field) as never,
      changed,
      change_note: changeNote,
    })
    .select("id")
    .maybeSingle();
  if (insErr) console.error("Recon mentés hiba:", insErr.message);

  if (changed) {
    const ok = learned.length > 0;
    await sendTelegram(
      [
        `🔵 ${input.platform} felület megváltozott (${input.pageType})`,
        changeNote ?? "",
        ok
          ? `Az új fogódzókat megtanultam: ${learned.map((l) => l.field).join(", ")}`
          : "Új fogódzót NEM sikerült megtanulni — érdemes ránézni.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    snapshotId: (inserted?.id as string | undefined) ?? null,
    learned,
    proposals,
    changed,
    changeNote,
  };
}
