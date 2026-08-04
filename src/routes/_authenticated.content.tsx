import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Send, Trash2, Trophy } from "lucide-react";

import {
  listContentDrafts,
  saveContentDraft,
  deleteContentDraft,
  queueContentDraft,
  recommendMatureRedditAccount,
} from "@/lib/content-drafts.functions";
import { listBrainWorkflowsForWarmup } from "@/lib/reddit-warmup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const KINDS = [
  { value: "reddit_post", label: "Reddit poszt" },
  { value: "reddit_comment", label: "Reddit hozzászólás" },
  { value: "linkedin_post", label: "LinkedIn poszt" },
  { value: "generic_text", label: "Egyéb szöveg" },
];

export const Route = createFileRoute("/_authenticated/content")({
  component: ContentStudioPage,
  head: () => ({
    meta: [
      { title: "Tartalom Stúdió — Kylo Brain" },
      {
        name: "description",
        content:
          "Illeszd be a poszt szövegét, válaszd ki a cél-workflow-t, és a worker emberi tempóban begépeli.",
      },
      { property: "og:title", content: "Tartalom Stúdió — Kylo Brain" },
      {
        property: "og:description",
        content: "Beillesztett szöveg kiküldése bármelyik Brain workflow-nak, emberi gépeléssel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ContentStudioPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listContentDrafts);
  const saveFn = useServerFn(saveContentDraft);
  const delFn = useServerFn(deleteContentDraft);
  const queueFn = useServerFn(queueContentDraft);
  const wfFn = useServerFn(listBrainWorkflowsForWarmup);
  const recFn = useServerFn(recommendMatureRedditAccount);

  const draftsQ = useQuery({ queryKey: ["content-drafts"], queryFn: () => listFn() });
  const wfQ = useQuery({ queryKey: ["content-workflows"], queryFn: () => wfFn() });
  const recQ = useQuery({ queryKey: ["mature-reddit"], queryFn: () => recFn() });

  const [kind, setKind] = useState("reddit_post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [targetRef, setTargetRef] = useState("");

  // Ha még nincs kiválasztott workflow, a legérettebb fiókét ajánljuk fel.
  useEffect(() => {
    const best = recQ.data?.best;
    if (!workflowId && best?.workflow_id) setWorkflowId(best.workflow_id);
  }, [recQ.data, workflowId]);

  const saveM = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          kind,
          title,
          body,
          target_workflow_id: workflowId || null,
          target_ref: targetRef || null,
        },
      }),
    onSuccess: () => {
      toast.success("Szöveg elmentve.");
      setTitle("");
      setBody("");
      setTargetRef("");
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const queueM = useMutation({
    mutationFn: (v: { id: string; dry_run: boolean }) =>
      queueFn({ data: { id: v.id, dry_run: v.dry_run } }),
    onSuccess: () => {
      toast.success("Sorba állítva — a worker begépeli.");
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Törölve.");
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const workflows = wfQ.data ?? [];
  const best = recQ.data?.best;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardPaste className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold">Tartalom Stúdió</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">
        Illeszd be ide a szöveget (Ctrl+V a saját gépeden), válaszd ki, melyik workflow
        vigye ki, és a worker emberi tempóban begépeli a távoli böngészőben — nem
        vágólapról másol, tehát életszerű marad.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-amber-500" /> Ma esti ajánlás — legérettebb Reddit fiók
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recQ.isLoading && <p className="text-sm text-muted-foreground">Számolás…</p>}
          {best && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{best.username ?? "névtelen"}</Badge>
              <Badge variant="outline">{best.locale ?? best.language}</Badge>
              <span className="text-muted-foreground">
                {best.days} nap · {best.minutes} perc · {best.upvotes} upvote · pontszám{" "}
                <b>{best.score}</b>
              </span>
              <Badge variant={best.ready ? "default" : "secondary"}>
                {best.ready ? "érett" : "még melegszik"}
              </Badge>
            </div>
          )}
          <div className="space-y-1 pt-2">
            {(recQ.data?.ranked ?? []).slice(1, 6).map((r) => (
              <div key={r.account_id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-40 truncate">{r.username ?? "névtelen"}</span>
                <span>{r.locale ?? r.language}</span>
                <span>{r.days} nap</span>
                <span>{r.upvotes} upvote</span>
                <span>pont: {r.score}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Új szöveg</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Típus</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cél workflow</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger><SelectValue placeholder="Válassz workflow-t" /></SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.platform ? ` · ${w.platform}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Hely (pl. subreddit)</Label>
              <Input
                value={targetRef}
                onChange={(e) => setTargetRef(e.target.value)}
                placeholder="r/EnglishLearning"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Cím</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A poszt címe" />
          </div>
          <div className="space-y-1">
            <Label>Szöveg</Label>
            <Textarea
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ide illeszd be a poszt szövegét…"
            />
            <p className="text-xs text-muted-foreground">{body.length} karakter</p>
          </div>
          <Button onClick={() => saveM.mutate()} disabled={!body.trim() || saveM.isPending}>
            {saveM.isPending ? "Mentés…" : "Mentés"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mentett szövegek</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(draftsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Még nincs mentett szöveg.</p>
          )}
          {(draftsQ.data ?? []).map((d) => (
            <div key={d.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{d.title || "(cím nélkül)"}</span>
                <Badge variant="outline">{d.kind}</Badge>
                {d.target_ref && <Badge variant="secondary">{d.target_ref}</Badge>}
                <Badge variant={d.status === "queued" ? "default" : "secondary"}>{d.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {workflows.find((w) => w.id === d.target_workflow_id)?.name ?? "nincs workflow"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{d.body}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => queueM.mutate({ id: d.id, dry_run: true })}
                  disabled={queueM.isPending}
                >
                  Próba (begépel, nem küldi el)
                </Button>
                <Button
                  size="sm"
                  onClick={() => queueM.mutate({ id: d.id, dry_run: false })}
                  disabled={queueM.isPending}
                >
                  <Send className="mr-2 size-4" /> Kiküldés a workflow-nak
                </Button>
                <Button size="sm" variant="ghost" onClick={() => delM.mutate(d.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
