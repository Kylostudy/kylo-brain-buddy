import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, HardDrive, Boxes, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeployPanel } from "@/components/deploy-panel";

export const Route = createFileRoute("/_authenticated/worker-health")({
  head: () => ({
    meta: [
      { title: "Worker terhelés — Kylo" },
      {
        name: "description",
        content:
          "A VPS worker percenkénti terhelési adatai: processzor, memória, lemez és a futó konténerek száma.",
      },
      { property: "og:title", content: "Worker terhelés — Kylo" },
      {
        property: "og:description",
        content: "Percenkénti gép-életjel a VPS workerről: CPU, RAM, lemez, konténerek.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkerHealth,
});

type Beat = {
  id: string;
  worker_id: string;
  cpu_percent: number | null;
  load1: number | null;
  mem_percent: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
  disk_percent: number | null;
  containers_running: number | null;
  inflight_jobs: number | null;
  created_at: string;
};

function fmt(n: number | null | undefined, unit = "") {
  return n === null || n === undefined ? "—" : `${n}${unit}`;
}

function Bar({ value }: { value: number | null }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={
          v > 90 ? "h-full bg-destructive" : v > 70 ? "h-full bg-amber-500" : "h-full bg-primary"
        }
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

function WorkerHealth() {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("worker_heartbeats")
      .select(
        "id,worker_id,cpu_percent,load1,mem_percent,mem_used_mb,mem_total_mb,disk_percent,containers_running,inflight_jobs,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    setBeats((data ?? []) as Beat[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const latest = beats[0];
  const peaks = useMemo(() => {
    const num = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
    return {
      cpu: Math.max(0, ...num(beats.map((b) => b.cpu_percent))),
      mem: Math.max(0, ...num(beats.map((b) => b.mem_percent))),
      containers: Math.max(0, ...num(beats.map((b) => b.containers_running))),
      jobs: Math.max(0, ...num(beats.map((b) => b.inflight_jobs))),
    };
  }, [beats]);

  const stale =
    latest && Date.now() - new Date(latest.created_at).getTime() > 5 * 60_000;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Activity className="size-6" /> Worker terhelés
          </h1>
          <p className="text-sm text-muted-foreground">
            A VPS percenként küld életjelet. Itt látod, mennyit bír a gép.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Frissítés
        </Button>
      </header>

      <DeployPanel />

      {!latest && !loading && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Még nem érkezett életjel. Frissítsd a workert a VPS-en, és pár perc múlva
          megjelennek az adatok.
        </p>
      )}

      {latest && (
        <>
          {stale && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Az utolsó életjel több mint 5 perce érkezett — a worker valószínűleg áll.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Cpu className="size-4" /> Processzor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-semibold">{fmt(latest.cpu_percent, "%")}</div>
                <Bar value={latest.cpu_percent} />
                <p className="text-xs text-muted-foreground">
                  Csúcs: {fmt(peaks.cpu, "%")} · terhelés: {fmt(latest.load1)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Activity className="size-4" /> Memória
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-semibold">{fmt(latest.mem_percent, "%")}</div>
                <Bar value={latest.mem_percent} />
                <p className="text-xs text-muted-foreground">
                  {fmt(latest.mem_used_mb)} / {fmt(latest.mem_total_mb)} MB · csúcs:{" "}
                  {fmt(peaks.mem, "%")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="size-4" /> Lemez
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-semibold">{fmt(latest.disk_percent, "%")}</div>
                <Bar value={latest.disk_percent} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Boxes className="size-4" /> Futó folyamatok
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-2xl font-semibold">
                  {fmt(latest.containers_running)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Ebből munka: {fmt(latest.inflight_jobs)} · csúcs: {fmt(peaks.jobs)} munka /{" "}
                  {fmt(peaks.containers)} konténer
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Utolsó mérések ({beats.length} sor)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">Idő</th>
                    <th className="py-1 text-left">Worker</th>
                    <th className="py-1 text-right">CPU</th>
                    <th className="py-1 text-right">RAM</th>
                    <th className="py-1 text-right">Lemez</th>
                    <th className="py-1 text-right">Konténer</th>
                    <th className="py-1 text-right">Munka</th>
                  </tr>
                </thead>
                <tbody>
                  {beats.slice(0, 120).map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="py-1">
                        {new Date(b.created_at).toLocaleString("hu-HU")}
                      </td>
                      <td className="py-1">{b.worker_id}</td>
                      <td className="py-1 text-right">{fmt(b.cpu_percent, "%")}</td>
                      <td className="py-1 text-right">{fmt(b.mem_percent, "%")}</td>
                      <td className="py-1 text-right">{fmt(b.disk_percent, "%")}</td>
                      <td className="py-1 text-right">{fmt(b.containers_running)}</td>
                      <td className="py-1 text-right">{fmt(b.inflight_jobs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
