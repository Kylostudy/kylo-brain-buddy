// Recording session lifecycle: a felhasználó indít egy live böngésző-felvételt,
// a saját VPS workerünk felveszi (claim), Realtime broadcast-on streameli a
// képkockákat és fogadja a kattintásokat, végül elmenti a felvett akciókat
// a workflow specjébe.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RecordedAction, WorkflowSpec } from "@/lib/chat.functions";

export const startRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        startUrl: z
          .string()
          .url()
          .max(2048)
          .optional()
          .or(z.literal("").transform(() => undefined)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    // Workflow tulajdonjogának ellenőrzése (RLS úgyis védi, de korai hibázás barátságosabb)
    const { data: wf, error: wfErr } = await supabase
      .from("workflows")
      .select("id, spec")
      .eq("id", data.workflowId)
      .maybeSingle();
    if (wfErr) throw new Error(wfErr.message);
    if (!wf) throw new Error("A workflow nem található vagy nincs hozzá jogod.");

    // Ha nem kaptunk start URL-t, vegyük a spec-ből (media_source vagy start_url).
    const spec = (wf.spec as WorkflowSpec | null) ?? {};
    const startUrl =
      data.startUrl?.trim() ||
      spec.start_url ||
      (spec.media_source && /^https?:\/\//i.test(spec.media_source)
        ? spec.media_source
        : undefined);

    // Frissítés / bezárt modál után ne ragadjon bent régi VPS-session.
    const { error: cleanupErr } = await supabase
      .from("recording_sessions")
      .update({
        status: "cancelled",
        ended_at: nowIso,
        error: "Új felvétel indult, a korábbi session lezárva.",
      })
      .eq("workflow_id", data.workflowId)
      .eq("tenant_id", userId)
      .in("status", ["requested", "active"]);
    if (cleanupErr) throw new Error(cleanupErr.message);

    const { data: session, error } = await supabase
      .from("recording_sessions")
      .insert({
        workflow_id: data.workflowId,
        tenant_id: userId,
        status: "requested",
        start_url: startUrl ?? null,
      })
      .select("id, status, start_url, created_at")
      .single();
    if (error) throw new Error(error.message);

    return session;
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
    const nextSpec: WorkflowSpec = {
      ...currentSpec,
      recorded_actions: data.actions as RecordedAction[],
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
          action_log: data.actions,
          ended_at: nowIso,
        })
        .eq("id", data.sessionId),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    return { ok: true, savedCount: data.actions.length };
  });
