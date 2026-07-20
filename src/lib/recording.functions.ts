// Recording session lifecycle: a felhasználó indít egy live böngésző-felvételt,
// a saját VPS workerünk felveszi (claim), Realtime broadcast-on streameli a
// képkockákat és fogadja a kattintásokat, végül elmenti a felvett akciókat
// a workflow specjébe.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RecordedAction, WorkflowSpec } from "@/lib/chat.functions";
import { normalizeRecordingStartUrl } from "@/lib/recording-url";

// Bármelyik Supabase kliens (auth-middleware `context.supabase`) elfogadható —
// nincs szükség generikus típusra ehhez a védelmi ellenőrzéshez.
async function assertNoActiveRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workflowId: string,
) {
  const { data: activeRun } = await supabase
    .from("brain_workflow_runs")
    .select("id")
    .eq("workflow_id", workflowId)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (activeRun) {
    throw new Error(
      "Ehhez a workflow-hoz jelenleg fut egy automatikus feladat — várd meg vagy szakítsd meg, mielőtt Live Browse-t / felvételt indítasz. Két egyidejű belépés ugyanabba az accountba anti-bot gyanút kelt.",
    );
  }
}

async function assertNoActiveBrowseOrRecord(
  supabase: { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { in: (c: string, v: string[]) => { maybeSingle: () => Promise<{ data: { id: string; mode: string } | null }> } } } } },
  workflowId: string,
) {
  const { data: activeSession } = await supabase
    .from("recording_sessions")
    .select("id, mode")
    .eq("workflow_id", workflowId)
    .in("status", ["requested", "active"])
    .maybeSingle();
  if (activeSession) {
    const label = activeSession.mode === "browse" ? "Live Browse" : "felvétel";
    throw new Error(
      `Ezen a workflow-n jelenleg nyitva van egy ${label} ablak. Zárd be előbb, mielőtt új sessiont indítasz — nem szabad kétszer belépni ugyanabba az accountba egyszerre.`,
    );
  }
}

async function createSession(
  supabase: Parameters<typeof assertNoActiveRun>[0] & { from: (t: string) => any },
  userId: string,
  workflowId: string,
  mode: "record" | "browse",
  requestedStartUrl: string | undefined,
) {
  // Workflow tulajdonjogának ellenőrzése (RLS úgyis védi, de korai hibázás barátságosabb)
  const { data: wf, error: wfErr } = await (supabase as any)
    .from("workflows")
    .select("id, platform, spec")
    .eq("id", workflowId)
    .maybeSingle();
  if (wfErr) throw new Error(wfErr.message);
  if (!wf) throw new Error("A workflow nem található vagy nincs hozzá jogod.");

  // Konkurencia védelem: nincs futó run és nincs másik nyitott recording session.
  await assertNoActiveRun(supabase, workflowId);
  await assertNoActiveBrowseOrRecord(supabase, workflowId);

  // Start URL a spec-ből, ha nem adtunk meg explicit-et.
  const spec = (wf.spec as WorkflowSpec | null) ?? {};
  const startUrl = normalizeRecordingStartUrl(
    requestedStartUrl?.trim() ||
    spec.start_url ||
    (spec.media_source && /^https?:\/\//i.test(spec.media_source)
      ? spec.media_source
      : undefined),
    wf.platform || spec.platform,
  );

  const { data: session, error } = await (supabase as any)
    .from("recording_sessions")
    .insert({
      workflow_id: workflowId,
      tenant_id: userId,
      status: "requested",
      start_url: startUrl ?? null,
      mode,
    })
    .select("id, status, start_url, created_at, mode")
    .single();
  if (error) throw new Error(error.message);

  return session;
}

export const startRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        startUrl: z
          .string()
          .max(2048)
          .optional()
          .or(z.literal("").transform(() => undefined)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    return createSession(
      context.supabase as never,
      context.userId,
      data.workflowId,
      "record",
      data.startUrl,
    );
  });

export const startLiveBrowse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        startUrl: z
          .string()
          .max(2048)
          .optional()
          .or(z.literal("").transform(() => undefined)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    return createSession(
      context.supabase as never,
      context.userId,
      data.workflowId,
      "browse",
      data.startUrl,
    );
  });

export const cancelRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("recording_sessions")
      .update({ status: "cancelled", ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .in("status", ["requested", "active"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string(), t: z.number() }),
  z.object({
    type: z.literal("click"),
    selector: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    text: z.string().optional(),
    t: z.number(),
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string().optional(),
    value: z.string().optional(),
    text: z.string().optional(),
    t: z.number(),
  }),
  z.object({ type: z.literal("key"), key: z.string(), t: z.number() }),
  z.object({
    type: z.literal("scroll"),
    x: z.number(),
    y: z.number(),
    t: z.number(),
  }),
  z.object({ type: z.literal("wait"), ms: z.number(), t: z.number() }),
]);

export const saveRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        actions: z.array(ActionSchema).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: session, error: sErr } = await supabase
      .from("recording_sessions")
      .select("id, workflow_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!session) throw new Error("Session nem található.");

    // Töltsük be a workflow specet, frissítsük a recorded_actions mezőt.
    const { data: wf, error: wErr } = await supabase
      .from("workflows")
      .select("spec")
      .eq("id", session.workflow_id)
      .single();
    if (wErr) throw new Error(wErr.message);

    const currentSpec = (wf?.spec as WorkflowSpec | null) ?? {};
    const normalizedActions = data.actions.map((action) => {
      if (action.type === "click") {
        return {
          ...action,
          selector:
            typeof action.selector === "string" && action.selector.trim()
              ? action.selector
              : `point:${Math.round((action.x ?? 0) * 10000)},${Math.round((action.y ?? 0) * 10000)}`,
        };
      }
      if (action.type === "type") {
        return {
          ...action,
          selector:
            typeof action.selector === "string" && action.selector.trim()
              ? action.selector
              : "activeElement",
        };
      }
      return action;
    }) as RecordedAction[];
    const nextSpec: WorkflowSpec = {
      ...currentSpec,
      recorded_actions: normalizedActions,
    };

    const nowIso = new Date().toISOString();
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase
        .from("workflows")
        .update({ spec: nextSpec, updated_at: nowIso })
        .eq("id", session.workflow_id),
      supabase
        .from("recording_sessions")
        .update({
          status: "completed",
          action_log: normalizedActions,
          ended_at: nowIso,
        })
        .eq("id", data.sessionId),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    return { ok: true, savedCount: normalizedActions.length };
  });
