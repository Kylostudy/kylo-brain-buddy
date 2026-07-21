import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ExternalLink, EyeOff, Bookmark, Copy, Plus, Settings2 } from "lucide-react";

import {
  listRedditScoutWatches,
  createRedditScoutWorkflow,
  updateRedditScoutWatch,
  listRedditScoutFindings,
  updateRedditScoutFindingStatus,
  runRedditScout,
} from "@/lib/reddit-scout.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/reddit-scout")({
  component: RedditScoutPage,
  head: () => ({
    meta: [
      { title: "Reddit Scout — Kylo Brain" },
      { name: "description", content: "Read-only Reddit figyelő nyelvtanulói subreddit-ekhez, Gemini-alapú relevancia-pontozással." },
      { property: "og:title", content: "Reddit Scout — Kylo Brain" },
      { property: "og:description", content: "Read-only Reddit figyelő nyelvtanulói subreddit-ekhez." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function RedditScoutPage() {
  const qc = useQueryClient();
  const callList = useServerFn(listRedditScoutWatches);
  const callFindings = useServerFn(listRedditScoutFindings);
  const callRun = useServerFn(runRedditScout);
  const callUpdateStatus = useServerFn(updateRedditScoutFindingStatus);
  const callCreate = useServerFn(createRedditScoutWorkflow);
  const callUpdateWatch = useServerFn(updateRedditScoutWatch);

  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [minRelevance, setMinRelevance] = useState(60);
  const [statusFilter, setStatusFilter] = useState<"new" | "saved" | "hidden" | "all">("new");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const watchesQ = useQuery({
    queryKey: ["reddit-scout-watches"],
    queryFn: () => callList({}),
  });

  const activeWorkflow = selectedWorkflow ?? watchesQ.data?.[0]?.workflow.id ?? null;
  const activeWatch = watchesQ.data?.find((w) => w.workflow.id === activeWorkflow) ?? null;

  const findingsQ = useQuery({
    queryKey: ["reddit-scout-findings", activeWorkflow, statusFilter, minRelevance],
    queryFn: () =>
      activeWorkflow
        ? callFindings({ data: { workflowId: activeWorkflow, status: statusFilter, minRelevance } })
        : Promise.resolve([]),
    enabled: !!activeWorkflow,
  });

  const runMut = useMutation({
    mutationFn: (workflowId: string) => callRun({ data: { workflowId } }),
    onSuccess: (res) => {
      toast.success(`Kész: ${res.fetched} poszt beolvasva, ${res.saved} elemzve, ${res.skipped} már megvolt.`);
      qc.invalidateQueries({ queryKey: ["reddit-scout-findings"] });
      qc.invalidateQueries({ queryKey: ["reddit-scout-watches"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scout futtatás sikertelen."),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "new" | "saved" | "hidden" }) =>
      callUpdateStatus({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reddit-scout-findings"] }),
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reddit Scout</h1>
          <p className="text-sm text-muted-foreground">
            Read-only figyelő nyelvi subreddit-ekhez. Gemini pontozza a Kylo.study szempontjából releváns szálakat. Semmi automatikus válasz.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="size-4" /> Új figyelő
            </Button>
          </DialogTrigger>
          <CreateWatchDialog
            onClose={() => setCreateOpen(false)}
            onCreate={async (payload) => {
              try {
                await callCreate({ data: payload });
                toast.success("Figyelő létrehozva.");
                setCreateOpen(false);
                qc.invalidateQueries({ queryKey: ["reddit-scout-watches"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Nem sikerült létrehozni.");
              }
            }}
          />
        </Dialog>
      </header>

      <div className="flex flex-wrap gap-2">
        {watchesQ.data?.map(({ workflow, watch }) => (
          <Button
            key={workflow.id}
            size="sm"
            variant={activeWorkflow === workflow.id ? "default" : "outline"}
            onClick={() => setSelectedWorkflow(workflow.id)}
            className="gap-2"
          >
            {workflow.name}
            {watch?.subreddits?.length ? (
              <Badge variant="secondary" className="text-[10px]">{watch.subreddits.length} sub</Badge>
            ) : null}
          </Button>
        ))}
        {watchesQ.data?.length === 0 && !watchesQ.isLoading && (
          <p className="text-sm text-muted-foreground">
            Még nincs figyelő. Kattints az „Új figyelő" gombra.
          </p>
        )}
      </div>

      {activeWatch && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">{activeWatch.workflow.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {activeWatch.watch?.subreddits?.length
                  ? activeWatch.watch.subreddits.map((s) => `r/${s}`).join(" · ")
                  : "Nincs subreddit"}
                {activeWatch.watch?.last_scanned_at && (
                  <> · Utolsó scan: {new Date(activeWatch.watch.last_scanned_at).toLocaleString("hu-HU")}</>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Settings2 className="size-4" /> Beállítások
                  </Button>
                </DialogTrigger>
                {activeWatch.watch && (
                  <EditWatchDialog
                    initial={{
                      subreddits: activeWatch.watch.subreddits ?? [],
                      positioning: activeWatch.watch.positioning ?? "",
                      languageLabel: activeWatch.watch.language_label ?? "",
                    }}
                    onClose={() => setEditOpen(false)}
                    onSave={async (payload) => {
                      try {
                        await callUpdateWatch({ data: { workflowId: activeWatch.workflow.id, ...payload } });
                        toast.success("Mentve.");
                        setEditOpen(false);
                        qc.invalidateQueries({ queryKey: ["reddit-scout-watches"] });
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Mentés sikertelen.");
                      }
                    }}
                  />
                )}
              </Dialog>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => runMut.mutate(activeWatch.workflow.id)}
                disabled={runMut.isPending}
              >
                <RefreshCw className={`size-4 ${runMut.isPending ? "animate-spin" : ""}`} /> Scan most
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 pt-0">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Min. relevancia:</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={minRelevance}
                onChange={(e) => setMinRelevance(Number(e.target.value) || 0)}
                className="h-8 w-20"
              />
            </div>
            <div className="flex items-center gap-1">
              {(["new", "saved", "hidden", "all"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "ghost"}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "new" ? "Új" : s === "saved" ? "Mentett" : s === "hidden" ? "Elrejtett" : "Mind"}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {findingsQ.isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
        {findingsQ.data?.length === 0 && !findingsQ.isLoading && (
          <p className="text-sm text-muted-foreground">
            Nincs találat ezekkel a szűrőkkel. Indíts egy „Scan most" futást.
          </p>
        )}
        {findingsQ.data?.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            targetLang={activeWatch?.watch?.language_label || "en"}
            onStatus={(status) => statusMut.mutate({ id: f.id, status })}
          />
        ))}
      </div>
    </div>
  );
}

function FindingCard({
  finding,
  targetLang,
  onStatus,
}: {
  finding: Awaited<ReturnType<typeof listRedditScoutFindings>>[number];
  targetLang: string;
  onStatus: (status: "new" | "saved" | "hidden") => void;
}) {
  const rel = finding.relevance ?? 0;
  const relColor =
    rel >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : rel >= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${relColor}`}>
                {rel}/100
              </span>
              <span>r/{finding.subreddit}</span>
              {finding.author && <span>· u/{finding.author}</span>}
              {finding.post_created_at && (
                <span>· {new Date(finding.post_created_at).toLocaleString("hu-HU")}</span>
              )}
            </div>
            <CardTitle className="mt-1 text-base leading-snug">{finding.title}</CardTitle>
          </div>
          <a
            href={finding.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Megnyitás Redditen"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {finding.body_excerpt && (
          <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
            {finding.body_excerpt}
          </p>
        )}
        {finding.angle_hu && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Kapcsolódási pont</div>
            <p className="whitespace-pre-wrap">{finding.angle_hu}</p>
          </div>
        )}
        {finding.suggested_reply_hu && (
          <div className="rounded-md border border-dashed p-2 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Válaszjavaslat (magyar)</div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-xs"
                onClick={async () => {
                  await navigator.clipboard.writeText(finding.suggested_reply_hu ?? "");
                  toast.success("Válasz vágólapra másolva.");
                }}
              >
                <Copy className="size-3" /> Másolás
              </Button>
            </div>
            <p className="whitespace-pre-wrap">{finding.suggested_reply_hu}</p>
          </div>
        )}

        <TranslationEditor
          targetLang={targetLang}
          subreddit={finding.subreddit ?? undefined}
          contextTitle={finding.title ?? undefined}
          replyingTo={finding.body_excerpt ?? undefined}
          initialHu={finding.suggested_reply_hu ?? ""}
        />
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => onStatus("saved")}>
            <Bookmark className="size-3.5" /> Mentés
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => onStatus("hidden")}>
            <EyeOff className="size-3.5" /> Elrejt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateWatchDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (v: { name: string; languageLabel: string; subreddits: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [languageLabel, setLanguageLabel] = useState("");
  const [subredditsText, setSubredditsText] = useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Új Reddit Scout figyelő</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Név</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="pl. Angol nyelvtanulók" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nyelvi címke (opcionális)</Label>
          <Input value={languageLabel} onChange={(e) => setLanguageLabel(e.target.value)} placeholder="en / it / ja / ..." />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Subredditek (soronként vagy vesszővel, „r/" prefix nem kötelező)</Label>
          <Textarea
            rows={5}
            value={subredditsText}
            onChange={(e) => setSubredditsText(e.target.value)}
            placeholder={"EnglishLearning\nIELTS\nTOEFL"}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Mégse</Button>
        <Button
          onClick={() => {
            const subs = subredditsText
              .split(/[\n,]+/)
              .map((s) => s.trim().replace(/^r\//i, ""))
              .filter(Boolean);
            if (!name.trim()) return toast.error("Név kötelező.");
            if (subs.length === 0) return toast.error("Legalább egy subreddit kell.");
            onCreate({ name: name.trim(), languageLabel: languageLabel.trim(), subreddits: subs });
          }}
        >
          Létrehozás
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditWatchDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: { subreddits: string[]; positioning: string; languageLabel: string };
  onClose: () => void;
  onSave: (v: { subreddits: string[]; positioning: string; languageLabel: string }) => void;
}) {
  const [subredditsText, setSubredditsText] = useState(initial.subreddits.join("\n"));
  const [positioning, setPositioning] = useState(initial.positioning);
  const [languageLabel, setLanguageLabel] = useState(initial.languageLabel);

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Figyelő beállítása</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Nyelvi címke</Label>
          <Input value={languageLabel} onChange={(e) => setLanguageLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Subredditek (soronként)</Label>
          <Textarea rows={6} value={subredditsText} onChange={(e) => setSubredditsText(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kylo.study pozicionálás (Gemini prompt)</Label>
          <Textarea rows={12} value={positioning} onChange={(e) => setPositioning(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Mégse</Button>
        <Button
          onClick={() => {
            const subs = subredditsText
              .split(/[\n,]+/)
              .map((s) => s.trim().replace(/^r\//i, ""))
              .filter(Boolean);
            onSave({ subreddits: subs, positioning, languageLabel });
          }}
        >
          Mentés
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
