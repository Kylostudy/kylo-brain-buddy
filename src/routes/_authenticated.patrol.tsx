import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, RefreshCw, Send, Trash2 } from "lucide-react";

import {
  addPostWatch,
  deletePostWatch,
  listPatrolComments,
  listPostWatches,
  markPatrolCommentStatus,
  runPatrolNow,
  sendTelegramTest,
  setPostWatchActive,
} from "@/lib/reddit-post-patrol.functions";
import { listRedditWorkflows, listRedditAccounts } from "@/lib/reddit-inbox.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/patrol")({
  component: PatrolPage,
  head: () => ({
    meta: [
      { title: "Poszt-őrjárat — Kylo Brain" },
      {
        name: "description",
        content:
          "Reddit posztjaid alatti új kommentek automatikus figyelése, magyar fordítás és Telegramos válaszjóváhagyás.",
      },
      { property: "og:title", content: "Poszt-őrjárat — Kylo Brain" },
      {
        property: "og:description",
        content:
          "Új Reddit kommentek figyelése, magyar fordítás és válaszjavaslatok Telegramon.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("hu-HU");
}

function PatrolPage() {
  const qc = useQueryClient();
  const fnWatches = useServerFn(listPostWatches);
  const fnComments = useServerFn(listPatrolComments);
  const fnWorkflows = useServerFn(listRedditWorkflows);
  const fnAccounts = useServerFn(listRedditAccounts);
  const fnAdd = useServerFn(addPostWatch);
  const fnDelete = useServerFn(deletePostWatch);
  const fnToggle = useServerFn(setPostWatchActive);
  const fnRun = useServerFn(runPatrolNow);
  const fnTest = useServerFn(sendTelegramTest);
  const fnMark = useServerFn(markPatrolCommentStatus);

  const watches = useQuery({ queryKey: ["post-watches"], queryFn: () => fnWatches() });
  const comments = useQuery({
    queryKey: ["patrol-comments"],
    queryFn: () => fnComments({ data: { status: "all" } }),
  });
  const workflows = useQuery({ queryKey: ["reddit-workflows"], queryFn: () => fnWorkflows() });
  const accounts = useQuery({ queryKey: ["reddit-accounts"], queryFn: () => fnAccounts() });

  const [permalink, setPermalink] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [accountId, setAccountId] = useState("");

  const add = useMutation({
    mutationFn: () =>
      fnAdd({
        data: {
          permalink,
          workflowId,
          ...(accountId ? { accountId } : {}),
          language: "en",
        },
      }),
    onSuccess: () => {
      toast.success("Poszt felvéve a figyelésbe.");
      setPermalink("");
      void qc.invalidateQueries({ queryKey: ["post-watches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: (watchId?: string) =>
      fnRun({ data: watchId ? { watchId } : {} }),
    onSuccess: (r) => {
      toast.success(
        `Átvizsgálva. Új komment: ${r.newComments}, Telegram értesítés: ${r.notified}.`,
      );
      void qc.invalidateQueries({ queryKey: ["post-watches"] });
      void qc.invalidateQueries({ queryKey: ["patrol-comments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => fnTest({}),
    onSuccess: () => toast.success("Teszt üzenet elküldve Telegramra."),
    onError: (e: Error) => toast.error(e.message),
  });

  const mark = useMutation({
    mutationFn: (v: { id: string; status: "answered" | "ignored" }) =>
      fnMark({ data: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["patrol-comments"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Poszt-őrjárat</h1>
        <p className="text-sm text-muted-foreground">
          Figyeli a saját Reddit posztjaid alatti új kommenteket, magyarra fordítja őket,
          és Telegramon küld válaszjavaslatot. Semmit nem posztol ki magától.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Új figyelt poszt</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            <Send className="mr-2 size-4" />
            Telegram teszt
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="permalink">Poszt linkje</Label>
            <Input
              id="permalink"
              placeholder="https://www.reddit.com/r/SaaS/comments/..."
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Workflow (fiók)</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Válassz workflow-t" />
                </SelectTrigger>
                <SelectContent>
                  {(workflows.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reddit fiók (opcionális)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Válassz fiókot" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.username ?? a.locale ?? a.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => add.mutate()}
            disabled={!permalink.trim() || !workflowId || add.isPending}
          >
            Figyelés indítása
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Figyelt posztok ({watches.data?.length ?? 0})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => run.mutate(undefined)}
            disabled={run.isPending}
          >
            <RefreshCw className={`mr-2 size-4 ${run.isPending ? "animate-spin" : ""}`} />
            Átvizsgálás most
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(watches.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Még nincs figyelt poszt.</p>
          )}
          {(watches.data ?? []).map((w) => (
            <div
              key={w.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  {w.subreddit && <Badge variant="secondary">r/{w.subreddit}</Badge>}
                  <span className="truncate text-sm font-medium">
                    {w.title ?? w.permalink}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Utolsó átvizsgálás: {fmt(w.last_scanned_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={w.active}
                  onCheckedChange={(v) =>
                    fnToggle({ data: { id: w.id, active: v } }).then(() =>
                      qc.invalidateQueries({ queryKey: ["post-watches"] }),
                    )
                  }
                />
                <Button variant="ghost" size="icon" asChild>
                  <a href={w.permalink} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    fnDelete({ data: { id: w.id } }).then(() =>
                      qc.invalidateQueries({ queryKey: ["post-watches"] }),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Kommentek ({comments.data?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(comments.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Még nincs begyűjtött komment.</p>
          )}
          {(comments.data ?? []).map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">u/{c.author ?? "?"}</Badge>
                {c.subreddit && <Badge variant="secondary">r/{c.subreddit}</Badge>}
                <Badge>{c.reply_status}</Badge>
                <span className="text-xs text-muted-foreground">{fmt(c.posted_at)}</span>
              </div>
              <p className="text-sm">{c.body_hu ?? c.body_en}</p>
              {(c.approved_reply_en ?? c.suggested_reply_en) && (
                <div className="rounded-md bg-muted p-2 text-sm">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {c.approved_reply_en ? "Jóváhagyott válasz" : "Javasolt válasz"} (angol)
                  </p>
                  <p>{c.approved_reply_en ?? c.suggested_reply_en}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      c.approved_reply_en ?? c.suggested_reply_en ?? "",
                    );
                    toast.success("Válasz a vágólapon.");
                  }}
                >
                  <Copy className="mr-2 size-4" />
                  Másolás
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={c.permalink} target="_blank" rel="noreferrer">
                    Megnyitás Redditen
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => mark.mutate({ id: c.id, status: "answered" })}
                >
                  Megválaszolva
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => mark.mutate({ id: c.id, status: "ignored" })}
                >
                  Kihagyás
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
