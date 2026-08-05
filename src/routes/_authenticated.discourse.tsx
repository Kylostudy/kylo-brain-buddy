import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, EyeOff, RefreshCw } from "lucide-react";

import {
  listDiscourseSnapshots,
  listDiscourseSuggestions,
  runDiscourseNow,
  updateDiscourseSuggestionStatus,
} from "@/lib/reddit-discourse.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/discourse")({
  component: DiscoursePage,
  head: () => ({
    meta: [
      { title: "Reddit diskurzus-elemző — Kylo Brain" },
      {
        name: "description",
        content:
          "Nyelvtanuló subredditek napi tartalomelemzése és konkrét beszállási javaslatok magyar vázlattal.",
      },
      { property: "og:title", content: "Reddit diskurzus-elemző — Kylo Brain" },
      {
        property: "og:description",
        content:
          "Miről folyik a diskurzus a nyelvtanuló subredditekben, és hol érdemes bekapcsolódni.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Theme = {
  theme_hu?: string;
  share_percent?: number;
  typical_question_hu?: string;
  pain_point_hu?: string;
  example_permalink?: string;
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("hu-HU");
}

function DiscoursePage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"new" | "done" | "hidden" | "all">("new");

  const snapshots = useQuery({
    queryKey: ["discourse-snapshots"],
    queryFn: () => listDiscourseSnapshots(),
  });
  const suggestions = useQuery({
    queryKey: ["discourse-suggestions", status],
    queryFn: () => listDiscourseSuggestions({ data: { status } }),
  });

  const runFn = useServerFn(runDiscourseNow);
  const run = useMutation({
    mutationFn: (force: boolean) => runFn({ data: { force } }),
    onSuccess: (res) => {
      toast.success(
        `Elemzés kész: ${res.snapshots} pillanatkép, ${res.suggestions} javaslat.`,
        { duration: 5000 },
      );
      if (res.errors.length) toast.warning(res.errors.slice(0, 3).join(" · "), { duration: 8000 });
      qc.invalidateQueries({ queryKey: ["discourse-snapshots"] });
      qc.invalidateQueries({ queryKey: ["discourse-suggestions"] });
    },
    onError: (err: Error) => toast.error(err.message, { duration: 6000 }),
  });

  const setStatusFn = useServerFn(updateDiscourseSuggestionStatus);
  const markStatus = useMutation({
    mutationFn: (v: { id: string; status: "new" | "done" | "hidden" }) =>
      setStatusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discourse-suggestions"] }),
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reddit diskurzus-elemző</h1>
          <p className="text-sm text-muted-foreground">
            Naponta megnézi, miről beszélnek a figyelt nyelvtanuló subredditekben, és
            pár nap adat után javaslatot tesz, hova érdemes beszállni.
          </p>
        </div>
        <Button onClick={() => run.mutate(true)} disabled={run.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${run.isPending ? "animate-spin" : ""}`} />
          Elemzés most
        </Button>
      </header>

      <Tabs defaultValue="suggestions">
        <TabsList>
          <TabsTrigger value="suggestions">Javaslatok</TabsTrigger>
          <TabsTrigger value="snapshots">Napi elemzések</TabsTrigger>
        </TabsList>

        <TabsContent value="suggestions" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            {(["new", "done", "hidden", "all"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "default" : "outline"}
                onClick={() => setStatus(s)}
              >
                {s === "new" ? "Új" : s === "done" ? "Kész" : s === "hidden" ? "Elrejtve" : "Mind"}
              </Button>
            ))}
          </div>

          {suggestions.isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
          {suggestions.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Még nincs javaslat. Legalább 3 nap gyűjtés kell hozzá.
            </p>
          )}

          {suggestions.data?.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{s.headline_hu}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">r/{s.subreddit}</Badge>
                    <Badge variant={s.entry_type === "post" ? "default" : "secondary"}>
                      {s.entry_type === "post" ? "Új poszt" : "Hozzászólás"}
                    </Badge>
                    <Badge variant="secondary">{s.confidence}%</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{s.rationale_hu}</p>
                <p className="text-muted-foreground">
                  Mikor: {s.best_time_hu || "—"} · {s.based_on_days} nap adatából
                </p>
                <div className="whitespace-pre-wrap rounded-md bg-muted p-3">{s.draft_hu}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(s.draft_hu);
                      toast.success("Vázlat kimásolva.", { duration: 3000 });
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Másolás
                  </Button>
                  {s.target_permalink && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={s.target_permalink} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Szál megnyitása
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markStatus.mutate({ id: s.id, status: "done" })}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Kész
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markStatus.mutate({ id: s.id, status: "hidden" })}
                  >
                    <EyeOff className="mr-2 h-4 w-4" />
                    Elrejt
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="snapshots" className="space-y-4 pt-4">
          {snapshots.isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
          {snapshots.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Még nincs napi elemzés. Indítsd el az „Elemzés most” gombbal.
            </p>
          )}
          {snapshots.data?.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">r/{s.subreddit}</CardTitle>
                  <div className="flex items-center gap-2">
                    {s.language_label && <Badge variant="outline">{s.language_label}</Badge>}
                    <Badge variant="secondary">{fmtDate(s.snapshot_date)}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{s.summary_hu}</p>
                <p className="text-muted-foreground">{s.tone_hu}</p>
                <p className="text-xs text-muted-foreground">
                  {s.posts_analyzed} poszt · {s.comments_analyzed} komment
                </p>
                <div className="space-y-2">
                  {((s.themes as Theme[] | null) ?? []).map((t, i) => (
                    <div key={i} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t.theme_hu}</span>
                        <Badge variant="secondary">{t.share_percent ?? 0}%</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{t.typical_question_hu}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t.pain_point_hu}</p>
                      {t.example_permalink && (
                        <a
                          className="mt-1 inline-block text-xs underline"
                          href={t.example_permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          példa szál
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
