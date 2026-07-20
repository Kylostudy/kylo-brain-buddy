import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, Check, EyeOff, ExternalLink, Wand2 } from "lucide-react";

import {
  listRedditWorkflows,
  listRedditAccounts,
  upsertRedditAccount,
  refreshRedditAccount,
  listRedditComments,
  updateRedditCommentStatus,
  translateReplyToEnglish,
} from "@/lib/reddit-inbox.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

type RedditComment = Awaited<ReturnType<typeof listRedditComments>>[number];

function InboxPage() {
  const qc = useQueryClient();
  const callWorkflows = useServerFn(listRedditWorkflows);
  const callAccounts = useServerFn(listRedditAccounts);
  const callUpsert = useServerFn(upsertRedditAccount);
  const callRefresh = useServerFn(refreshRedditAccount);
  const callComments = useServerFn(listRedditComments);
  const callStatus = useServerFn(updateRedditCommentStatus);
  const callTranslate = useServerFn(translateReplyToEnglish);

  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");

  const { data: workflows = [] } = useQuery({
    queryKey: ["reddit-workflows"],
    queryFn: () => callWorkflows(),
  });

  const currentWorkflowId = activeWorkflowId ?? workflows[0]?.id ?? null;

  const { data: accounts = [] } = useQuery({
    queryKey: ["reddit-accounts", currentWorkflowId],
    queryFn: () =>
      currentWorkflowId
        ? callAccounts({ data: { workflowId: currentWorkflowId } })
        : Promise.resolve([]),
    enabled: !!currentWorkflowId,
  });

  const currentAccount = accounts[0] ?? null;

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["reddit-comments", currentWorkflowId],
    queryFn: () =>
      currentWorkflowId
        ? callComments({ data: { workflowId: currentWorkflowId, status: "pending" } })
        : Promise.resolve([]),
    enabled: !!currentWorkflowId,
  });

  const upsertMut = useMutation({
    mutationFn: (username: string) =>
      callUpsert({
        data: {
          id: currentAccount?.id,
          workflowId: currentWorkflowId!,
          username,
          locale:
            (workflows.find((w) => w.id === currentWorkflowId)?.spec as Record<string, unknown> | null)
              ?.locale as string | undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Fiók mentve.");
      setUsernameDraft("");
      qc.invalidateQueries({ queryKey: ["reddit-accounts", currentWorkflowId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshMut = useMutation({
    mutationFn: (accountId: string) => callRefresh({ data: { accountId } }),
    onSuccess: (r) => {
      toast.success(`Frissítve. Új válaszok: ${r.newSaved}`);
      qc.invalidateQueries({ queryKey: ["reddit-accounts", currentWorkflowId] });
      qc.invalidateQueries({ queryKey: ["reddit-comments", currentWorkflowId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (workflows.length === 0) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Reddit Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Még nincs Reddit workflow. Hozz létre egyet a bal oldali listából (platform: reddit).
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reddit Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Válaszra váró kommentek magyarul, fordítással és javaslattal. Nincs auto-válasz — csak
          kézi másolás.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {workflows.map((w) => {
          const active = w.id === currentWorkflowId;
          return (
            <Button
              key={w.id}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => setActiveWorkflowId(w.id)}
            >
              {w.name}
            </Button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fiók</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Reddit felhasználónév</Label>
            <Input
              placeholder={currentAccount?.username ?? "u/valami"}
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value.replace(/^u\//, ""))}
            />
          </div>
          {currentAccount && (
            <div className="text-xs text-muted-foreground">
              Karma: <span className="font-mono">{currentAccount.karma ?? "—"}</span> · Utolsó
              ellenőrzés:{" "}
              {currentAccount.last_checked_at
                ? new Date(currentAccount.last_checked_at).toLocaleString("hu-HU")
                : "még soha"}
            </div>
          )}
          <Button
            size="sm"
            onClick={() => usernameDraft.trim() && upsertMut.mutate(usernameDraft.trim())}
            disabled={!usernameDraft.trim() || !currentWorkflowId || upsertMut.isPending}
          >
            {currentAccount ? "Frissítés" : "Mentés"}
          </Button>
          {currentAccount && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => refreshMut.mutate(currentAccount.id)}
              disabled={refreshMut.isPending}
            >
              <RefreshCw className={`mr-1 size-3.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              Új válaszok lekérése
            </Button>
          )}
        </CardContent>
      </Card>

      <section className="flex-1 space-y-3 overflow-y-auto">
        {commentsLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
        {!commentsLoading && comments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nincsenek válaszra váró kommentek. Kattints a „Új válaszok lekérése" gombra.
          </p>
        )}
        {comments.map((c) => (
          <CommentCard
            key={c.id}
            comment={c}
            onStatus={(status) =>
              callStatus({ data: { id: c.id, status } }).then(() => {
                qc.invalidateQueries({ queryKey: ["reddit-comments", currentWorkflowId] });
              })
            }
            onTranslate={async (text) => {
              const r = await callTranslate({ data: { text } });
              return r.english;
            }}
          />
        ))}
      </section>
    </div>
  );
}

function CommentCard({
  comment,
  onStatus,
  onTranslate,
}: {
  comment: RedditComment;
  onStatus: (status: "answered" | "ignored") => void;
  onTranslate: (hungarian: string) => Promise<string>;
}) {
  const [huDraft, setHuDraft] = useState(comment.suggested_reply_hu ?? "");
  const [enDraft, setEnDraft] = useState(comment.suggested_reply_en ?? "");
  const [translating, setTranslating] = useState(false);

  const posted = useMemo(
    () => (comment.posted_at ? new Date(comment.posted_at).toLocaleString("hu-HU") : ""),
    [comment.posted_at],
  );

  async function copyEn() {
    await navigator.clipboard.writeText(enDraft);
    toast.success("Angol válasz vágólapra másolva.");
  }

  async function translate() {
    if (!huDraft.trim()) return;
    setTranslating(true);
    try {
      const en = await onTranslate(huDraft);
      setEnDraft(en);
      toast.success("Lefordítva angolra.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">
              <Badge variant="secondary" className="mr-1">
                {comment.subreddit ?? "?"}
              </Badge>
              <span className="font-mono">u/{comment.author}</span> · {posted}
            </div>
            {comment.context_title && (
              <div className="mt-1 text-sm font-medium">{comment.context_title}</div>
            )}
          </div>
          <a
            href={comment.permalink}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ExternalLink className="size-3" /> Reddit
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
          {comment.body_en}
        </div>
        {comment.body_hu && (
          <div className="rounded-md border border-dashed p-3 text-sm whitespace-pre-wrap">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Magyar fordítás
            </div>
            {comment.body_hu}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Válasz magyarul (szerkeszthető)</Label>
            <Textarea
              value={huDraft}
              onChange={(e) => setHuDraft(e.target.value)}
              rows={5}
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={translate}
              disabled={translating || !huDraft.trim()}
            >
              <Wand2 className="mr-1 size-3.5" />
              Fordítás angolra
            </Button>
          </div>
          <div>
            <Label className="text-xs">Angol változat (tiszta plain text a másoláshoz)</Label>
            <Textarea
              value={enDraft}
              onChange={(e) => setEnDraft(e.target.value)}
              rows={5}
              className="font-mono text-sm"
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={copyEn} disabled={!enDraft.trim()}>
                <Copy className="mr-1 size-3.5" />
                Másolás
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onStatus("answered")}>
                <Check className="mr-1 size-3.5" />
                Megválaszoltnak jelöl
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onStatus("ignored")}>
                <EyeOff className="mr-1 size-3.5" />
                Elrejt
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
