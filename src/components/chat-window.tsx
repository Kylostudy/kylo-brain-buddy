import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain } from "lucide-react";

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
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Mic } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { generateMockReply } from "@/lib/chat.functions";

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

export function ChatWindow({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callMock = useServerFn(generateMockReply);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", workflowId],
    queryFn: () => fetchMessages(workflowId),
  });

  useEffect(() => {
    // Focus textarea on mount + workflow change
    textareaRef.current?.focus();
  }, [workflowId]);

  async function handleSubmit(msg: PromptInputMessage) {
    const text = msg.text?.trim();
    if (!text || sending) return;
    setSending(true);

    try {
      // 1) Save user message
      const { error: userErr } = await supabase.from("messages").insert({
        workflow_id: workflowId,
        role: "user",
        content: text,
      });
      if (userErr) throw userErr;
      await qc.invalidateQueries({ queryKey: ["messages", workflowId] });

      // 2) Get mock AI reply
      const { reply } = await callMock({
        data: { userText: text, workflowId },
      });

      // 3) Save assistant message
      const { error: aiErr } = await supabase.from("messages").insert({
        workflow_id: workflowId,
        role: "assistant",
        content: reply,
      });
      if (aiErr) throw aiErr;

      await qc.invalidateQueries({ queryKey: ["messages", workflowId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
    } catch (e) {
      console.error(e);
      toast.error("Üzenet küldése sikertelen");
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
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
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput onSubmit={handleSubmit} accept="image/*,application/pdf" multiple>
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Hangrögzítés (hamarosan)"
                onClick={() => toast.info("Mikrofon: hamarosan")}
              >
                <Mic className="size-4" />
              </Button>
            </PromptInputTools>
            <PromptInputSubmit status={sending ? "submitted" : undefined} />
          </PromptInputFooter>
        </PromptInput>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Mock válasz aktív · Gemini bekötés után élesedik
        </p>
      </div>
    </div>
  );
}
