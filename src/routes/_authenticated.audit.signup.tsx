import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  startKyloSignupRun,
  listKyloSignupRuns,
  ensureKyloSignupWorkflow,
} from "@/lib/kylo-signup.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useModule } from "@/lib/module/provider";

export const Route = createFileRoute("/_authenticated/audit/signup")({
  head: () => ({
    meta: [
      { title: "Kylo Sign Up — KyloAudit" },
      { name: "description", content: "Automatikus Kylo.study regisztrációs tesztek különböző proxykkal, alias e-mailekkel és váltakozó skinnel." },
      { property: "og:title", content: "Kylo Sign Up — KyloAudit" },
      { property: "og:description", content: "Automatikus regisztrációs tesztek Kylo.study-hoz." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

type SignupRun = {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  spec_snapshot: unknown;
  result: unknown;
  error: string | null;
  proxy_id: string | null;
};

function statusColor(s: string) {
  if (s === "succeeded" || s === "completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (s === "failed" || s === "timed_out") return "bg-red-500/15 text-red-400 border-red-500/40";
  if (s === "running") return "bg-blue-500/15 text-blue-400 border-blue-500/40";
  return "bg-yellow-500/15 text-yellow-500 border-yellow-500/40";
}

function readSignupSpec(spec: unknown): {
  skin?: string;
  lang?: string;
  currency?: string;
  email?: string;
  expected_country?: string | null;
  run_index?: number;
} {
  if (!spec || typeof spec !== "object") return {};
  const s = (spec as { kylo_signup?: Record<string, unknown> }).kylo_signup;
  return (s as never) ?? {};
}

function readResult(r: unknown): {
  reached_stripe?: boolean;
  final_url?: string;
  screenshots?: Array<{ label: string; at: string; b64?: string; error?: string }>;
  steps?: Array<Record<string, unknown>>;
} {
  if (!r || typeof r !== "object") return {};
  return r as never;
}

function SignupPage() {
  const { forceModule } = useModule();
  const qc = useQueryClient();
  const startFn = useServerFn(startKyloSignupRun);
  const listFn = useServerFn(listKyloSignupRuns);

  useEffect(() => {
    forceModule("audit");
  }, [forceModule]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["kylo-signup-runs"],
    queryFn: () => listFn(),
    refetchInterval: 5000,
  });

  const startMut = useMutation({
    mutationFn: () => startFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Sign Up #${r.runIndex} sorba téve — skin=${r.skin}, alias=${r.email}, ország=${r.country ?? "?"}`);
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runs = (data?.runs as SignupRun[] | undefined) ?? [];
  const nextSkinHint = (() => {
    const spec = data?.workflow?.spec as { kylo_signup?: { last_skin?: string } } | null;
    const last = spec?.kylo_signup?.last_skin;
    if (last === "puppy-cat") return "alaszka";
    if (last === "alaszka") return "puppy-cat";
    return "alaszka (első futás)";
  })();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Kylo Sign Up</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Minden „Új futás" kattintás váltogatva Puppy Cat és Alaszka skinnel,
            új proxyval és új plusz-alias e-maillel (sunyika.kripto+kylo&lt;N&gt;@gmail.com)
            próbál végigmenni a Kylo.study regisztráción a Stripe fizetésig.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            size="lg"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
          >
            {startMut.isPending ? "Indítás…" : "Új futás indítása"}
          </Button>
          <div className="text-xs text-muted-foreground">
            Következő skin: <span className="font-medium">{nextSkinHint}</span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Legutóbbi futások</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Betöltés…</div>}
          {!isLoading && runs.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Még nincs futás. Kattints az „Új futás indítása" gombra.
            </div>
          )}
          {runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Idő</th>
                    <th className="py-2 pr-3">Státusz</th>
                    <th className="py-2 pr-3">Skin</th>
                    <th className="py-2 pr-3">Ország / nyelv</th>
                    <th className="py-2 pr-3">Alias</th>
                    <th className="py-2 pr-3">Stripe?</th>
                    <th className="py-2 pr-3">Részletek</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const spec = readSignupSpec(r.spec_snapshot);
                    const res = readResult(r.result);
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 text-muted-foreground">{spec.run_index ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {r.started_at ? new Date(r.started_at).toLocaleString("hu-HU") : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                        </td>
                        <td className="py-2 pr-3">{spec.skin ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {spec.expected_country ?? "?"} · {spec.lang ?? "?"}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{spec.email ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {res.reached_stripe === true ? (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40" variant="outline">Igen</Badge>
                          ) : res.reached_stripe === false ? (
                            <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/40" variant="outline">Nem</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <RunDetailsDialog run={r} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>Frissítés</Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        <Link to="/audit/qa" className="underline">Vissza a Kylo.study QA-hoz</Link>
      </div>
    </div>
  );
}

function RunDetailsDialog({ run }: { run: SignupRun }) {
  const [open, setOpen] = useState(false);
  const spec = readSignupSpec(run.spec_snapshot);
  const res = readResult(run.result);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Megnyit</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sign Up #{spec.run_index ?? "?"} — {spec.skin ?? "?"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div><span className="text-muted-foreground">Alias:</span> <span className="font-mono">{spec.email}</span></div>
          <div><span className="text-muted-foreground">Ország / nyelv / valuta:</span> {spec.expected_country ?? "?"} · {spec.lang ?? "?"} · {spec.currency ?? "?"}</div>
          <div><span className="text-muted-foreground">Végállomás:</span> {res.final_url ?? "—"}</div>
          {run.error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-red-300">
              <div className="text-xs font-semibold uppercase">Hiba</div>
              <div className="whitespace-pre-wrap break-words">{run.error}</div>
            </div>
          )}
          {Array.isArray(res.steps) && res.steps.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Lépések</div>
              <pre className="max-h-48 overflow-auto rounded-md border bg-background/40 p-2 text-xs">
                {JSON.stringify(res.steps, null, 2)}
              </pre>
            </div>
          )}
          {Array.isArray(res.screenshots) && res.screenshots.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Screenshotok</div>
              {res.screenshots.map((s, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-xs text-muted-foreground">{s.label} · {new Date(s.at).toLocaleTimeString("hu-HU")}</div>
                  {s.b64 ? (
                    <img
                      src={`data:image/jpeg;base64,${s.b64}`}
                      alt={s.label}
                      className="w-full rounded-md border"
                    />
                  ) : (
                    <div className="text-xs text-red-400">Nincs kép ({s.error ?? "?"})</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
