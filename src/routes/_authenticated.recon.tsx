import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Eye, RefreshCw, Send } from "lucide-react";

import {
  listLearnedSelectors,
  listReconSnapshots,
  queueReconRun,
  listBrainWorkflows,
} from "@/lib/ui-recon.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/recon")({
  component: ReconPage,
  head: () => ({
    meta: [
      { title: "Felderítő járat — Kylo Brain" },
      {
        name: "description",
        content:
          "A LinkedIn felületéről készült felderítő képernyőfotók, a rendszer által tanult fogódzók és a felület-változások naplója.",
      },
      { property: "og:title", content: "Felderítő járat — Kylo Brain" },
      {
        property: "og:description",
        content:
          "Képernyőfotók, AI-elemzés és tanult fogódzók, hogy a posztolás ne bukjon el felület-változáson.",
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

function ReconPage() {
  const qc = useQueryClient();
  const [workflowId, setWorkflowId] = useState<string>("");

  const snapshots = useQuery({
    queryKey: ["recon-snapshots"],
    queryFn: () => listReconSnapshots(),
  });
  const selectors = useQuery({
    queryKey: ["recon-selectors"],
    queryFn: () => listLearnedSelectors(),
  });
  const workflows = useQuery({
    queryKey: ["recon-workflows"],
    queryFn: () => listBrainWorkflows(),
  });

  const queueFn = useServerFn(queueReconRun);
  const queueMut = useMutation({
    mutationFn: () => queueFn({ data: { workflow_id: workflowId, platform: "linkedin" } }),
    onSuccess: () => {
      toast.success("Felderítő járat sorba állítva — a worker a következő körben elindítja.");
      qc.invalidateQueries({ queryKey: ["recon-snapshots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Felderítő járat</h1>
        <p className="text-muted-foreground text-sm">
          A rendszer emberi tempóban körbenéz a platformon, lefényképezi a felületet, és
          megtanulja, hol vannak a gombok. Így a posztolás nem hasal el egy felület-változáson.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Járat indítása most</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={workflowId} onValueChange={setWorkflowId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Válassz workflow-t (LinkedIn fiók)" />
            </SelectTrigger>
            <SelectContent>
              {(workflows.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name || w.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!workflowId || queueMut.isPending}
            onClick={() => queueMut.mutate()}
          >
            <Send className="mr-2 size-4" />
            Felderítés indítása
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              snapshots.refetch();
              selectors.refetch();
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            Frissítés
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tanult fogódzók</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(selectors.data ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">Még nincs tanult fogódzó.</p>
          )}
          {(selectors.data ?? []).map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {s.platform} · {s.page_type} · {s.field}
                </div>
                <code className="text-muted-foreground break-all text-xs">{s.selector}</code>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">✔ {s.success_count}</Badge>
                <Badge variant={s.fail_count > 0 ? "destructive" : "outline"}>
                  ✘ {s.fail_count}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  utoljára jó: {fmt(s.last_verified_at)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Felderítő fotók</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {(snapshots.data ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">
              Még nincs felderítő fotó. Indíts egy járatot fent.
            </p>
          )}
          {(snapshots.data ?? []).map((s) => (
            <div key={s.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {s.platform} · {s.page_type}
                </div>
                {s.changed ? (
                  <Badge variant="destructive">felület változott</Badge>
                ) : (
                  <Badge variant="outline">változatlan</Badge>
                )}
              </div>
              <div className="text-muted-foreground text-xs">{fmt(s.created_at)}</div>
              {s.image_url ? (
                <a href={s.image_url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={s.image_url}
                    alt={`${s.platform} ${s.page_type} felderítő képernyőfotó`}
                    loading="lazy"
                    className="w-full rounded border"
                  />
                </a>
              ) : (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Eye className="size-3" /> nincs mentett fotó
                </div>
              )}
              {s.change_note && <p className="text-xs">{s.change_note}</p>}
              {s.analysis?.layout_summary && (
                <p className="text-muted-foreground text-xs">{s.analysis.layout_summary}</p>
              )}
              {s.learned_fields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.learned_fields.map((f) => (
                    <Badge key={f} variant="secondary">
                      tanult: {f}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
