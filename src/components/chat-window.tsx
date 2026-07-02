import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, Play, Pencil, Video } from "lucide-react";
import { MicButton } from "@/components/mic-button";
import { BrowserRecorderModal } from "@/components/browser-recorder-modal";
import { startRecording } from "@/lib/recording.functions";


import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { supabase } from "@/integrations/supabase/client";
import {
  generateReply,
  renameWorkflow,
  resetReadyForTest,
} from "@/lib/chat.functions";
import { startRun } from "@/lib/runs.functions";
import { listProxies } from "@/lib/proxies.functions";
import { SpecPanel } from "@/components/spec-panel";


type DbMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

async function fetchMessages(workflowId: string): Promise<DbMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchWorkflowMeta(workflowId: string) {
  const { data, error } = await supabase
    .from("workflows")
    .select("name, ready_for_test")
    .eq("id", workflowId)
    .single();
  if (error) throw error;
  return data;
}

export function ChatWindow({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callAI = useServerFn(generateReply);
  const callRename = useServerFn(renameWorkflow);
  const callResetReady = useServerFn(resetReadyForTest);
  const callStartRun = useServerFn(startRun);
  const callStartRecording = useServerFn(startRecording);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recordSessionId, setRecordSessionId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [runner, setRunner] = useState<"docker">("docker");
  const [selectedProxyId, setSelectedProxyId] = useState<string>("");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);


  const { data: messages = [] } = useQuery({
    queryKey: ["messages", workflowId],
    queryFn: () => fetchMessages(workflowId),
  });

  const { data: meta } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => fetchWorkflowMeta(workflowId),
    refetchInterval: 2000,
  });

  const listProxiesFn = useServerFn(listProxies);
  const { data: proxies = [] } = useQuery({
    queryKey: ["proxies-for-run"],
    queryFn: () => listProxiesFn(),
    staleTime: 30_000,
  });



  useEffect(() => {
    textareaRef.current?.focus();
    setEditingName(false);
  }, [workflowId]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const renamingRef = useRef(false);
  async function commitRename() {
    if (renamingRef.current) return;
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === meta?.name) return;
    renamingRef.current = true;
    try {
      await callRename({ data: { workflowId, name: next } });
      await qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
    } catch (e) {
      console.error("rename failed", e);
      toast.error(e instanceof Error ? `Átnevezés sikertelen: ${e.message}` : "Átnevezés sikertelen");
    } finally {
      renamingRef.current = false;
    }
  }

  async function handleSubmit(msg: PromptInputMessage) {
    const text = msg.text?.trim();
    if (!text || sending) return;
    setSending(true);

    try {
      const { error: userErr } = await supabase.from("messages").insert({
        workflow_id: workflowId,
        role: "user",
        content: text,
      });
      if (userErr) throw userErr;
      await qc.invalidateQueries({ queryKey: ["messages", workflowId] });

      const result = await callAI({
        data: { userText: text, workflowId },
      });

      const { error: aiErr } = await supabase.from("messages").insert({
        workflow_id: workflowId,
        role: "assistant",
        content: result.reply,
      });
      if (aiErr) throw aiErr;

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messages", workflowId] }),
        qc.invalidateQueries({ queryKey: ["workflow", workflowId] }),
        qc.invalidateQueries({ queryKey: ["workflows"] }),
      ]);
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Üzenet küldése sikertelen",
      );
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function handleStartTest() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await callStartRun({
        data: {
          workflowId,
          runner,
          proxyId: selectedProxyId || null,
        },
      });

      if (res.status === "succeeded") {
        toast.success("Próbafuttatás sikeres (szimuláció).");
      } else if (res.status === "failed") {
        toast.error("Próbafuttatás hibára futott.");
      } else if (res.status === "queued") {
        toast.success("Sorba téve — a VPS worker rövidesen elindítja.");
      } else {
        toast.success("Futtatás elindítva — kövesd a jobb oldali panelen.");
      }
      await callResetReady({ data: { workflowId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["workflow", workflowId] }),
        qc.invalidateQueries({ queryKey: ["brain_workflow_runs", workflowId] }),
      ]);
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Futtatás indítása sikertelen",
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleEditMore() {
    await callResetReady({ data: { workflowId } });
    await qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
    textareaRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header with editable name */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5 shrink-0">
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="h-8 max-w-sm text-sm font-medium"
            />
          ) : (
            <button
              type="button"
              className="group/name flex items-center gap-2 rounded px-1.5 py-1 -mx-1.5 text-sm font-medium hover:bg-accent"
              onClick={() => {
                setNameDraft(meta?.name ?? "");
                setEditingName(true);
              }}
              title="Kattints az átnevezéshez"
            >
              <span className="truncate">{meta?.name ?? "Workflow"}</span>
              <Pencil className="size-3.5 opacity-0 transition group-hover/name:opacity-60" />
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const session = await callStartRecording({
                    data: { workflowId },
                  });
                  setRecordSessionId(session.id);
                  setRecordOpen(true);
                } catch (e) {
                  toast.error(
                    e instanceof Error
                      ? `Felvétel indítása sikertelen: ${e.message}`
                      : "Felvétel indítása sikertelen",
                  );
                }
              }}
              title="Élő böngésző felvétele"
            >
              <Video className="size-4" />
              <span className="ml-1.5 hidden sm:inline">Felvétel</span>
            </Button>
          </div>
        </div>


        <Conversation className="flex-1 min-h-0 overflow-auto">
          <ConversationContent className="mx-auto w-full max-w-3xl pb-6">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Brain className="size-10" />}
                title="Új workflow tanítása"
                description="Mondd el lépésről lépésre, mit szeretnél automatizálni. A Brain emberi módon, óvatosan, kérdésekkel haladva építi fel a folyamatot."
              />
            ) : (
              messages.map((m) => (
                <Message key={m.id} from={m.role as "user" | "assistant"}>
                  <MessageContent>
                    {m.role === "assistant" ? (
                      <MessageResponse>{m.content}</MessageResponse>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                  </MessageContent>
                </Message>
              ))
            )}

            {sending && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer>Gondolkodom…</Shimmer>
                </MessageContent>
              </Message>
            )}

            {meta?.ready_for_test && !sending && (
              <div className="mx-auto mt-2 w-full max-w-2xl rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Play className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      Kész a spec, mehet a teszt?
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      A Brain összegyűjtötte a workflow alapjait. Most lefuttathatsz egy próba feltöltést, vagy folytathatod a finomhangolást.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={handleStartTest} disabled={starting}>
                        <Play className="size-3.5" />
                        {starting ? "Indítás…" : "Teszt indítása"}
                      </Button>
                      <select
                        value={runner}
                        onChange={(e) => setRunner(e.target.value as "docker")}
                        disabled={starting}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        title="Hol fusson a teszt"
                      >
                        <option value="docker">Saját VPS worker (Playwright)</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={handleEditMore} disabled={starting}>
                        Még pontosítok
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 border-t bg-background mx-auto w-full max-w-3xl px-4 py-3">
          <PromptInput
            onSubmit={handleSubmit}
            accept="image/*,application/pdf"
            multiple
          >
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="Írd le a workflow következő lépését…"
            />
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
              </PromptInputTools>
              <div className="flex items-center gap-1">
                <MicButton
                  onTranscript={(text, { send }) => {
                    if (send) {
                      // Pipa → azonnal küldés, ne kelljen még egy gombot nyomni.
                      void handleSubmit({ text, files: [] } as PromptInputMessage);
                      return;
                    }
                    const ta = textareaRef.current;
                    if (!ta) return;
                    const current = ta.value;
                    const next = current ? `${current.replace(/\s+$/, "")} ${text}` : text;
                    const setter = Object.getOwnPropertyDescriptor(
                      window.HTMLTextAreaElement.prototype,
                      "value",
                    )?.set;
                    setter?.call(ta, next);
                    ta.dispatchEvent(new Event("input", { bubbles: true }));
                    ta.focus();
                  }}
                  disabled={sending}
                />

                <PromptInputSubmit status={sending ? "submitted" : undefined} />
              </div>
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">
            Gemini 2.5 Flash · betanítási mód
          </p>
        </div>
      </div>

      <SpecPanel workflowId={workflowId} />

      <BrowserRecorderModal
        open={recordOpen}
        sessionId={recordSessionId}
        onClose={() => {
          setRecordOpen(false);
          setRecordSessionId(null);
          void qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
        }}
      />
    </div>
  );
}

