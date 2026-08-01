import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  startKyloSignupRun,
  startAllEnglishSignupRuns,
  listKyloSignupRuns,
  ensureKyloSignupWorkflow,
  setKyloSignupRecorderProxy,
  deleteKyloSignupRun,
  deleteKyloSignupRuns,
  getKyloSignupSummary,
  getKyloSignupRun,
  cancelPendingSignupRuns,
  listPendingSignupBatches,
  explainKyloSignupRun,


} from "@/lib/kylo-signup.functions";
import { startGmailOAuth, disconnectGmail } from "@/lib/gmail.functions";
import { startRecording, startLiveBrowse } from "@/lib/recording.functions";
import { listProxies } from "@/lib/proxies.functions";
import { BrowserRecorderModal } from "@/components/browser-recorder-modal";
import { TestAccountsPanel } from "@/components/audit-qa/test-accounts-panel";
import { BatchErrorReports } from "@/components/audit-qa/batch-error-report";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Video, Globe } from "lucide-react";
import { useModule } from "@/lib/module/provider";
import { INFRA_STATUS, infraLabel } from "@/lib/infra-errors";

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
  // Proxy/hálózati hiba: nem termékhiba → borostyán, nem piros.
  if (s === INFRA_STATUS) return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  if (s === "failed" || s === "timed_out") return "bg-red-500/15 text-red-400 border-red-500/40";
  if (s === "running") return "bg-blue-500/15 text-blue-400 border-blue-500/40";
  return "bg-yellow-500/15 text-yellow-500 border-yellow-500/40";
}

function statusLabel(s: string) {
  return s === INFRA_STATUS ? "proxy hiba" : s;
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
  screenshots?: Array<{ label: string; at: string; b64?: string; url?: string; error?: string }>;
  steps?: Array<Record<string, unknown>>;
  language_ok?: boolean;
  expected_lang?: string;
  language_checks?: Array<{
    label: string;
    url?: string;
    ok?: boolean | null;
    html_lang?: string | null;
    expected_lang?: string;
    expected_hits?: number;
    english_hits?: number;
    reason?: string | null;
    sample?: string;
  }>;
  criteria?: Record<string, boolean>;
  criteria_failed?: string[];
  flow_ok?: boolean;
  currency_check?: {
    expected_currency?: string;
    detected_currency?: string | null;
    currency_candidates?: string[];
    ok?: boolean;
    undetected?: boolean;
  };
  ai_explanation?: { text?: string; generated_at?: string };
} {
  if (!r || typeof r !== "object") return {};
  return r as never;
}

const CRITERIA_LABELS_HU: Record<string, string> = {
  landing_english: "Nyitóoldal angolul jelenik meg",
  auth_dialog_language: "Belépési panel a cél nyelven",
  signup_form_language: "Regisztrációs űrlap a cél nyelven",
  registration_submitted: "Regisztráció elküldve",
  confirmation_email_received: "Megerősítő e-mail megérkezett",
  confirmation_email_language: "Megerősítő e-mail a cél nyelven",
  plan_page_language: "Csomagválasztó a cél nyelven",
  billing_form_language: "Számlázási űrlap a cél nyelven",
  reached_stripe: "Eljutott a Stripe fizetésig",
  stripe_paid: "Fizetés elküldve",
  payment_success_page_language: "Sikeres fizetés oldal a cél nyelven",
  reached_profile: "Eljutott a profil oldalra",
  profile_page_language: "Profil oldal a cél nyelven",
};



function SignupPage() {
  const { forceModule } = useModule();
  const qc = useQueryClient();
  const startFn = useServerFn(startKyloSignupRun);
  const startAllFn = useServerFn(startAllEnglishSignupRuns);
  const listFn = useServerFn(listKyloSignupRuns);
  const ensureFn = useServerFn(ensureKyloSignupWorkflow);
  const callStartRecording = useServerFn(startRecording);
  const callStartLiveBrowse = useServerFn(startLiveBrowse);

  const [recordOpen, setRecordOpen] = useState(false);
  const [recordSessionId, setRecordSessionId] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<"record" | "browse">("record");
  const [bulkAction, setBulkAction] = useState<"english" | "non-english" | "non-english-5" | "scheduled-non-english" | null>(null);
  const bulkLockRef = useRef(false);

  useEffect(() => {
    forceModule("audit");
  }, [forceModule]);

  // Első nyitáskor létrehozzuk a workflow-t, hogy a Gmail bekötése azonnal
  // elérhető legyen (a Hitelesítő adatok panel a workflow-hoz tartozik).
  const ensureMut = useMutation({
    mutationFn: () => ensureFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] }),
  });
  useEffect(() => {
    ensureMut.mutate();
    // csak első mountnál
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["kylo-signup-runs"],
    queryFn: () => listFn(),
    refetchInterval: 5000,
  });

  const gmail = (data?.gmail as { email: string; connectedAt: string | null } | null) ?? null;
  const workflowId = data?.workflow?.id ?? null;
  const recorderProxyId = (data as { recorderProxyId?: string | null } | undefined)?.recorderProxyId ?? null;


  const startMut = useMutation({
    mutationFn: () => startFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Sign Up #${r.runIndex} sorba téve — skin=${r.skin}, alias=${r.email}, ország=${r.country ?? "?"}`);
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });




  const [cancelOpen, setCancelOpen] = useState(false);
  const listBatchesFn = useServerFn(listPendingSignupBatches);
  const pendingBatchesQ = useQuery({
    queryKey: ["kylo-signup-pending-batches"],
    queryFn: () => listBatchesFn(),
    enabled: cancelOpen,
  });

  const cancelPendingFn = useServerFn(cancelPendingSignupRuns);
  const cancelPendingMut = useMutation({
    mutationFn: (batchId: string | null) => cancelPendingFn({ data: { batchId } }),
    onSuccess: (r) => {
      toast.success(`${r.canceled} sorban álló futás visszavonva`);
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
      qc.invalidateQueries({ queryKey: ["kylo-signup-pending-batches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const startAllMut = useMutation({

    mutationFn: (vars: { scope: "english" | "non-english" | "pricing"; notBefore?: string | null; limit?: number | null }) =>
      startAllFn({ data: { scope: vars.scope, notBefore: vars.notBefore ?? null, limit: vars.limit ?? null } }),
    onSuccess: (r, vars) => {
      toast.success(
        vars.notBefore
          ? `${r.count} futás időzítve ${new Date(vars.notBefore).toLocaleString("hu-HU")} utánra`
          : `${r.count} futás sorba téve — ${r.queued.map((q) => `#${q.runIndex} ${q.country ?? "?"}`).join(", ")}`,
      );
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      bulkLockRef.current = false;
      setBulkAction(null);
    },
  });

  function startBulk(
    vars: { scope: "english" | "non-english"; notBefore?: string | null; limit?: number | null },
    action: "english" | "non-english" | "non-english-5" | "scheduled-non-english",
  ) {
    if (startAllMut.isPending || bulkLockRef.current) return;
    bulkLockRef.current = true;
    setBulkAction(action);
    startAllMut.mutate(vars);
  }


  const runs = (data?.runs as SignupRun[] | undefined) ?? [];

  // — Kijelölés + tömeges törlés —
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = runs.length > 0 && runs.every((r) => selected.has(r.id));
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(runs.map((r) => r.id)));
  }
  const callBulkDelete = useServerFn(deleteKyloSignupRuns);
  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => callBulkDelete({ data: { runIds: ids } }),
    onSuccess: (res: { deleted?: number }) => {
      toast.success(`${res?.deleted ?? 0} futás törölve`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
      qc.invalidateQueries({ queryKey: ["kylo-signup-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextSkinHint = (() => {
    const spec = data?.workflow?.spec as { kylo_signup?: { last_skin?: string } } | null;
    const last = spec?.kylo_signup?.last_skin;
    if (last === "puppy-cat") return "alaszka";
    if (last === "alaszka") return "puppy-cat";
    return "alaszka (első futás)";
  })();

  const canStart = !!gmail;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Kylo Sign Up</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Minden „Új futás" kattintás váltogatva Puppy Cat és Alaszka skinnel,
            új proxyval és új plusz-alias e-maillel (sunyika.kripto+kylo&lt;N&gt;@gmail.com)
            próbál végigmenni a Kylo.study regisztráción a Stripe fizetésig.
          </p>
          {!gmail && (
            <p className="mt-2 text-xs text-yellow-500">
              ⚠️ Előbb kösd be a Gmail postafiókot (jobbra), különben a rendszer nem
              tudja kiolvasni az alias címekre érkező megerősítő linkeket.
              A jelenlegi automata script „felderítő" módban fut — a „succeeded" csak
              azt jelenti, hogy nem crashelt, nem azt, hogy sikerült regisztrálni.
              A rendes lépések a record & replay felvételből fognak jönni.
            </p>
          )}
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:items-end">
          <div className="flex w-full flex-wrap items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={!workflowId || !recorderProxyId}
              onClick={async () => {
                if (!workflowId) return;
                try {
                  const s = await callStartLiveBrowse({
                    data: { workflowId, startUrl: "https://kylo.study/?lang=en-GB" },
                  });
                  setRecordSessionId(s.id);
                  setRecordMode("browse");
                  setRecordOpen(true);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Live Browse indítása sikertelen");
                }
              }}
              title={recorderProxyId ? "Élő böngésző a VPS-en (kézi kattintás, nem menti a lépéseket)" : "Először válassz proxyt a Felvétel proxy panelen"}
            >
              <Globe className="size-4" />
              <span className="ml-1.5">Live Browse</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!workflowId || !recorderProxyId}
              onClick={async () => {
                if (!workflowId) return;
                try {
                  const s = await callStartRecording({
                    data: { workflowId, startUrl: "https://kylo.study/?lang=en-GB" },
                  });
                  setRecordSessionId(s.id);
                  setRecordMode("record");
                  setRecordOpen(true);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Felvétel indítása sikertelen");
                }
              }}
              title={recorderProxyId ? "Regisztrációs flow felvétele — a végén Mentéssel eltárolja a lépéseket a workflow specbe" : "Először válassz proxyt a Felvétel proxy panelen"}
            >
              <Video className="size-4" />
              <span className="ml-1.5">Felvétel</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => startBulk({ scope: "english" }, "english")}

              disabled={startAllMut.isPending || !canStart}
              title={canStart ? "Egyszerre indít egy futást minden angol nyelvterületi proxyra" : "Először kösd be a Gmail postafiókot"}
            >
              {bulkAction === "english" && startAllMut.isPending ? "Indítás…" : "Összes angol (terheléses)"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => startBulk({ scope: "non-english" }, "non-english")}

              disabled={startAllMut.isPending || !canStart}
              title={canStart ? "Egyszerre indít egy futást minden nem-angol proxyra, a proxy országának megfelelő nyelvvel" : "Először kösd be a Gmail postafiókot"}
            >
              {bulkAction === "non-english" && startAllMut.isPending ? "Indítás…" : "Összes nem-angol (nyelvi kör)"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => startBulk({ scope: "non-english", limit: 5 }, "non-english-5")}
              disabled={startAllMut.isPending || !canStart}
              title={canStart ? "Kis kör: 5 véletlenszerű, különböző országú nem-angol proxy — gyors ellenőrzéshez" : "Először kösd be a Gmail postafiókot"}
            >
              {bulkAction === "non-english-5" && startAllMut.isPending ? "Indítás…" : "5-ös nem-angol kör"}
            </Button>

            <Button
              type="button"
              variant="destructive"
              size="lg"
              onClick={() => setCancelOpen(true)}
              disabled={cancelPendingMut.isPending}
              title="Vészfék: kiválaszthatod, melyik sorban álló batchet vond vissza"
            >
              {cancelPendingMut.isPending ? "Visszavonás…" : "Sorban állók visszavonása"}
            </Button>


            <Button
              type="button"
              size="lg"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending || !canStart}
              title={canStart ? "" : "Először kösd be a Gmail postafiókot"}
            >
              {startMut.isPending ? "Indítás…" : "Új futás indítása"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Következő skin: <span className="font-medium">{nextSkinHint}</span>
          </div>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Melyik batchet vonjuk vissza?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {pendingBatchesQ.isLoading ? (
              <div className="text-muted-foreground">Betöltés…</div>
            ) : (pendingBatchesQ.data?.batches ?? []).length === 0 ? (
              <div className="text-muted-foreground">Nincs sorban álló futás.</div>
            ) : (
              <>
                {(pendingBatchesQ.data?.batches ?? []).map((b, i) => {
                  const idxs = [...b.runIndexes].sort((a, c) => a - c);
                  return (
                    <div
                      key={b.batchId ?? `single-${i}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {b.batchId
                            ? `${b.scope === "non-english" ? "Nem-angol" : b.scope === "english" ? "Angol" : "Batch"} · ${b.count} futás`
                            : `Egyedi futások · ${b.count} db`}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {b.startedAt ? new Date(b.startedAt).toLocaleString("hu-HU") : ""}
                          {idxs.length > 0 ? ` · #${idxs[0]}–#${idxs[idxs.length - 1]}` : ""}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={cancelPendingMut.isPending}
                        onClick={() => cancelPendingMut.mutate(b.batchId)}
                      >
                        Visszavonás
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={cancelPendingMut.isPending}
                  onClick={() => cancelPendingMut.mutate(null)}
                >
                  Mindet visszavonom
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>


      <Card>
        <CardHeader>
          <CardTitle>Gmail postafiók</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {gmail ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div>
                  Csatlakoztatva: <span className="font-mono">{gmail.email}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {gmail.connectedAt ? new Date(gmail.connectedAt).toLocaleString("hu-HU") : ""}
                </div>
              </div>
              {workflowId && <GmailConnectButton workflowId={workflowId} label="Újracsatlakoztatás" variant="outline" />}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-muted-foreground">
                Még nincs Gmail bekötve. Ez ahhoz kell, hogy az aliasokra
                (<span className="font-mono">sunyika.kripto+kyloN@gmail.com</span>)
                érkező megerősítő linkeket automatikusan ki tudjuk olvasni.
              </div>
              {workflowId ? (
                <GmailConnectButton workflowId={workflowId} label="Gmail csatlakoztatása" />
              ) : (
                <Button disabled>Betöltés…</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {workflowId && (
        <RecorderProxyCard workflowId={workflowId} currentProxyId={recorderProxyId} />
      )}


      <SummaryCard />

      <BatchErrorReports runs={runs} />

      <TestAccountsPanel />



      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Legutóbbi futások</CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allSelected}
                onChange={toggleAll}
              />
              Összes kijelölése
            </label>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 hover:text-red-300"
              disabled={selected.size === 0 || bulkDeleteMut.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Biztos törlöd a kijelölt ${selected.size} futást? Ez nem visszavonható.`,
                  )
                ) {
                  bulkDeleteMut.mutate(Array.from(selected));
                }
              }}
            >
              {bulkDeleteMut.isPending
                ? "Törlés…"
                : `Kijelöltek törlése (${selected.size})`}
            </Button>
          </div>
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
                    <th className="py-2 pr-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Összes kijelölése"
                      />
                    </th>
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Idő</th>
                    <th className="py-2 pr-3">Státusz</th>
                    <th className="py-2 pr-3">Skin</th>
                    <th className="py-2 pr-3">Ország / nyelv</th>
                    <th className="py-2 pr-3">Alias</th>
                    <th className="py-2 pr-3">Stripe?</th>
                    <th className="py-2 pr-3">Részletek</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const spec = readSignupSpec(r.spec_snapshot);
                    const res = readResult(r.result);
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={selected.has(r.id)}
                            onChange={() => toggleOne(r.id)}
                            aria-label="Futás kijelölése"
                          />
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{spec.run_index ?? "—"}</td>

                        <td className="py-2 pr-3">
                          {r.started_at ? new Date(r.started_at).toLocaleString("hu-HU") : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
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
                        <td className="py-2 pr-3">
                          <DeleteRunButton runId={r.id} />
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

      <BrowserRecorderModal
        open={recordOpen}
        sessionId={recordSessionId}
        mode={recordMode}
        onClose={() => {
          setRecordOpen(false);
          setRecordSessionId(null);
        }}
      />
    </div>
  );
}

function RunDetailsDialog({ run }: { run: SignupRun }) {
  const [open, setOpen] = useState(false);
  const detailFn = useServerFn(getKyloSignupRun);
  // A lista könnyű (nincs benne képernyőkép), a teljes adatot csak
  // a részletek ablak nyitásakor töltjük le.
  const { data: detail } = useQuery({
    queryKey: ["kylo-signup-run", run.id],
    queryFn: () => detailFn({ data: { runId: run.id } }),
    enabled: open,
  });
  const full = (detail?.run ?? null) as SignupRun | null;
  const spec = readSignupSpec(full?.spec_snapshot ?? run.spec_snapshot);
  const res = readResult(full?.result ?? run.result);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Megnyit</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Sign Up #{spec.run_index ?? "?"} — {spec.skin ?? "?"}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadRunReport(run, spec, res)}
            >
              Riport letöltése (JSON)
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 break-words text-sm [overflow-wrap:anywhere]">
          <div className={`rounded-md border p-2 ${
            run.status === "succeeded"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : run.status === INFRA_STATUS
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : run.status === "failed"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-muted bg-muted/20 text-muted-foreground"
          }`}>
            <div className="text-xs font-semibold uppercase">Összegzés</div>
            <div>{buildRunSummary(run, spec, res)}</div>
          </div>
          <AiExplanationBlock runId={run.id} initial={res.ai_explanation} enabled={open} />

          <div><span className="text-muted-foreground">Alias:</span> <span className="font-mono">{spec.email}</span></div>
          <div><span className="text-muted-foreground">Ország / nyelv / valuta:</span> {spec.expected_country ?? "?"} · {spec.lang ?? "?"} · {spec.currency ?? "?"}</div>
          <div><span className="text-muted-foreground">Végállomás:</span> {res.final_url ?? "—"}</div>
          <div
            className={`rounded-md border p-2 ${
              !res.currency_check
                ? "border-muted bg-muted/20 text-muted-foreground"
                : res.currency_check.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            <div className="text-xs font-semibold uppercase">Fizetési pénznem ellenőrzés</div>
            {res.currency_check ? (
              <div>
                Elvárt: <span className="font-mono">{res.currency_check.expected_currency ?? "?"}</span> · Észlelt:{" "}
                <span className="font-mono">
                  {res.currency_check.detected_currency ||
                    (res.currency_check.currency_candidates ?? []).join("/") ||
                    "nem felismerhető"}
                </span>{" "}
                → {res.currency_check.ok ? "OK" : "ELTÉRÉS"}
              </div>
            ) : (
              <div>
                Ez a futás még nem tartalmaz pénznem-ellenőrzést (a worker régebbi tesztszkripttel futott).
              </div>
            )}
          </div>
          {run.error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-red-300">
              <div className="text-xs font-semibold uppercase">Hiba</div>
              <div className="whitespace-pre-wrap break-words">{run.error}</div>
            </div>
          )}
          {res.criteria && Object.keys(res.criteria).length > 0 && (
            <div
              className={`rounded-md border p-2 ${
                res.flow_ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}
            >
              <div className="text-xs font-semibold uppercase">
                Sikerességi kritériumok — {Object.values(res.criteria).filter(Boolean).length}/
                {Object.keys(res.criteria).length} teljesült
              </div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {Object.entries(CRITERIA_LABELS_HU).map(([key, label]) =>
                  key in (res.criteria ?? {}) ? (
                    <li key={key}>
                      {res.criteria?.[key] ? "✅" : "❌"} {label}
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          {Array.isArray(res.language_checks) && res.language_checks.length > 0 && (

            <div
              className={`rounded-md border p-2 ${
                res.language_ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
              }`}
            >
              <div className="text-xs font-semibold uppercase">
                Nyelvi ellenőrzés — elvárt nyelv: {res.expected_lang ?? spec.lang ?? "?"}
              </div>
              <div className="mb-1">
                {res.language_ok
                  ? `Mind a ${res.language_checks.filter((c) => c.ok === true).length} értékelt oldal a várt nyelven jelent meg.`
                  : `${res.language_checks.filter((c) => c.ok === false).length} oldalon nem a várt nyelv jelent meg.`}
              </div>
              <ul className="space-y-1 text-xs">
                {res.language_checks.map((c, i) => (
                  <li key={i} className="break-words">
                    <span className="font-mono">{c.label}</span> · lang={c.html_lang ?? "?"} ·{" "}
                    {c.ok === false
                      ? `HIBA: ${c.reason ?? "nem a várt nyelv"} (elvárt találat: ${c.expected_hits ?? 0}, angol találat: ${c.english_hits ?? 0})`
                      : c.ok === null
                        ? "kihagyva"
                        : "OK"}
                    {c.url ? ` · ${c.url}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(res.steps) && res.steps.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Lépések</div>
              <pre className="max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md border bg-background/40 p-2 text-xs">
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
                  {s.url || s.b64 ? (
                    <img
                      src={s.url ?? `data:image/jpeg;base64,${s.b64}`}
                      alt={s.label}
                      loading="lazy"
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

function AiExplanationBlock({
  runId,
  initial,
  enabled,
}: {
  runId: string;
  initial?: { text?: string; generated_at?: string };
  enabled: boolean;
}) {
  const explain = useServerFn(explainKyloSignupRun);
  const [text, setText] = useState<string | null>(initial?.text ?? null);
  const [at, setAt] = useState<string | null>(initial?.generated_at ?? null);

  const mut = useMutation({
    mutationFn: (force: boolean) => explain({ data: { runId, force } }),
    onSuccess: (d: { text: string; generated_at: string | null }) => {
      setText(d.text);
      setAt(d.generated_at);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Megnyitáskor egyszer automatikusan legyártjuk, ha még nincs elemzés.
  const asked = useRef(false);
  useEffect(() => {
    if (enabled && !text && !asked.current) {
      asked.current = true;
      mut.mutate(false);
    }
  }, [enabled, text, mut]);

  return (
    <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-sky-100">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase">Elemzés emberi nyelven</div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={mut.isPending}
          onClick={() => mut.mutate(true)}
        >
          {mut.isPending ? "Készül…" : "Újragenerálás"}
        </Button>
      </div>
      {text ? (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {text.replace(/\*\*/g, "")}
        </div>
      ) : (
        <div className="text-xs text-sky-200/80">
          {mut.isPending ? "Az elemzés készül, ez pár másodperc…" : "Még nincs elemzés."}
        </div>
      )}
      {at && (
        <div className="mt-1 text-[10px] text-sky-200/60">
          Készült: {new Date(at).toLocaleString("hu-HU")}
        </div>
      )}
    </div>
  );
}

function DeleteRunButton({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const callDelete = useServerFn(deleteKyloSignupRun);
  const mut = useMutation({
    mutationFn: () => callDelete({ data: { runId } }),
    onSuccess: () => {
      toast.success("Futás törölve");
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-red-400 hover:text-red-300"
      onClick={() => {
        if (window.confirm("Biztos törlöd ezt a futást? Ez nem visszavonható.")) {
          mut.mutate();
        }
      }}
      disabled={mut.isPending}
    >
      {mut.isPending ? "Törlés…" : "Törlés"}
    </Button>
  );
}

function buildRunSummary(
  run: SignupRun,
  spec: ReturnType<typeof readSignupSpec>,
  res: ReturnType<typeof readResult>,
): string {
  const who = `#${spec.run_index ?? "?"} · ${spec.expected_country ?? "?"} · ${spec.skin ?? "?"} · ${spec.email ?? "?"}`;
  if (run.status === "succeeded") {
    if (res.reached_stripe === true) {
      return `${who} — Sikeres futás, a Stripe checkout oldalig eljutott (${res.final_url ?? "?"}).`;
    }
    const stepCount = Array.isArray(res.steps) ? res.steps.length : 0;
    const shots = Array.isArray(res.screenshots) ? res.screenshots.length : 0;
    if (stepCount === 0 && shots === 0) {
      return `${who} — A worker "sikeres"-nek jelölte, de nem futott le a sign-up script (nincsenek lépések vagy képek). Valószínűleg ismeretlen monitor_type miatt demo ágra esett. Frissítsd a worker imaget és indíts új futást.`;
    }
    return `${who} — Futás lefutott (${stepCount} lépés, ${shots} képernyőkép), de nem érte el a Stripe oldalt. Nézd meg a képeket és a lépéseket, hol akadt el.`;
  }
  if (run.status === INFRA_STATUS) {
    return `${who} — Nem a Kylo hibája: hálózati / proxy probléma (${infraLabel(
      (res as { infra_code?: string }).infra_code,
    )}). A rendszer automatikusan újrapróbálja másik proxyval.`;
  }
  if (run.status === "failed") {
    return `${who} — Hibára futott: ${run.error ?? "ismeretlen hiba"}.`;
  }
  return `${who} — Státusz: ${run.status}.`;
}

function downloadRunReport(
  run: SignupRun,
  spec: ReturnType<typeof readSignupSpec>,
  res: ReturnType<typeof readResult>,
) {
  const report = {
    run_id: run.id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    error: run.error,
    summary: buildRunSummary(run, spec, res),
    ai_explanation: res.ai_explanation?.text ?? null,
    spec,
    result: res,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kylo-signup-${spec.run_index ?? "run"}-${run.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function GmailConnectButton({
  workflowId,
  label,
  variant,
}: {
  workflowId: string;
  label: string;
  variant?: "outline" | "default";
}) {
  const qc = useQueryClient();
  const callStart = useServerFn(startGmailOAuth);
  const callDisconnect = useServerFn(disconnectGmail);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    // Fontos: az ablakot még a user-click stack-en belül kell megnyitni,
    // különben a böngésző popup-blockere blokkolja.
    const oauthWindow = window.open("about:blank", "_blank", "width=560,height=760");
    try {
      const host = window.location.hostname;
      const previewProjectId = host.endsWith(".lovableproject.com")
        ? host.replace(".lovableproject.com", "")
        : host.match(/^id-preview--([a-f0-9-]+)\.lovable\.app$/)?.[1];
      const slugPreview = host.match(/^preview--(.+)\.lovable\.app$/)?.[1];
      const callbackOrigin = slugPreview
        ? `https://${slugPreview}.lovable.app`
        : previewProjectId
          ? `https://project--${previewProjectId}-dev.lovable.app`
          : window.location.origin;
      const redirectUri = `${callbackOrigin}/api/public/auth/google/callback`;
      const { url } = await callStart({ data: { workflowId, redirectUri } });
      if (oauthWindow) {
        oauthWindow.location.href = url;
        window.addEventListener(
          "focus",
          () => qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] }),
          { once: true },
        );
        toast.success("A Google engedélyezés új ablakban nyílt meg.");
      } else {
        window.location.href = url;
      }
    } catch (e) {
      if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
      toast.error(e instanceof Error ? e.message : "Nem sikerült elindítani a Google OAuth-ot.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Biztos leválasztod a Gmail fiókot erről a workflow-ról?")) return;
    setBusy(true);
    try {
      await callDisconnect({ data: { workflowId } });
      toast.success("Gmail leválasztva.");
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Leválasztás sikertelen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size={variant === "outline" ? "sm" : "default"}
        variant={variant ?? "default"}
        onClick={handleConnect}
        disabled={busy}
      >
        {busy ? "Átirányítás…" : label}
      </Button>
      {variant === "outline" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDisconnect}
          disabled={busy}
        >
          Leválasztás
        </Button>
      )}
    </div>
  );
}

function RecorderProxyCard({
  workflowId,
  currentProxyId,
}: {
  workflowId: string;
  currentProxyId: string | null;
}) {
  const qc = useQueryClient();
  const callListProxies = useServerFn(listProxies);
  const callSetProxy = useServerFn(setKyloSignupRecorderProxy);
  const { data: proxies } = useQuery({
    queryKey: ["proxies-for-kylo-signup"],
    queryFn: () => callListProxies({ data: undefined as never }),
  });
  const [selected, setSelected] = useState<string>(currentProxyId ?? "");
  useEffect(() => {
    setSelected(currentProxyId ?? "");
  }, [currentProxyId]);
  const [busy, setBusy] = useState(false);
  const current = proxies?.find((p) => p.id === currentProxyId) ?? null;

  async function save(next: string | null) {
    setBusy(true);
    try {
      await callSetProxy({ data: { workflowId, proxyId: next } });
      toast.success(next ? "Proxy elmentve." : "Proxy törölve.");
      qc.invalidateQueries({ queryKey: ["kylo-signup-runs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nem sikerült menteni a proxyt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Felvétel / Live Browse proxy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="text-muted-foreground">
          A VPS böngésző ezzel a proxyval nyílik meg, amikor a fenti{" "}
          <span className="font-medium">Felvétel</span> vagy{" "}
          <span className="font-medium">Live Browse</span> gombra kattintasz.
          Az automatikus <span className="font-medium">„Új futás"</span> a saját
          rotációjából választ proxyt — ez a mező csak a kézi böngészésre vonatkozik.
        </div>
        {current && (
          <div className="text-xs">
            Jelenleg: <span className="font-medium">{current.label}</span>
            {current.country ? ` (${current.country})` : ""}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy || !proxies}
          >
            <option value="">— válassz proxyt —</option>
            {(proxies ?? [])
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.country ? ` — ${p.country}` : ""}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            onClick={() => save(selected || null)}
            disabled={busy || selected === (currentProxyId ?? "")}
          >
            {busy ? "Mentés…" : "Mentés"}
          </Button>
          {currentProxyId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected("");
                save(null);
              }}
              disabled={busy}
            >
              Törlés
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}



// ─────────────────────────────────────────────────────────────
// SummaryCard — összkép az ÖSSZES eddigi futásról
// ─────────────────────────────────────────────────────────────
type Summary = {
  total: number;
  byStatus: Record<string, number>;
  byError: Record<string, number>;
  byLang: Record<string, { total: number; ok: number; bad: number }>;
  loggedIn: number;
  reachedStripe?: number;
  reachedProfile?: number;
  avgActions: number | null;

};

function SummaryCard() {
  const callSummary = useServerFn(getKyloSignupSummary);
  const { data, isLoading } = useQuery({
    queryKey: ["kylo-signup-summary"],
    queryFn: () => callSummary({}),
  });
  const s = data as Summary | null | undefined;

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Összesítés</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Számolás…</CardContent>
      </Card>
    );
  }
  if (!s || s.total === 0) return null;

  const ok = s.byStatus.succeeded ?? 0;
  const bad = s.byStatus.failed ?? 0;
  const langs = Object.entries(s.byLang).sort((a, b) => a[0].localeCompare(b[0]));
  const errs = Object.entries(s.byError).sort((a, b) => b[1] - a[1]);
  const translated = langs.filter(([, v]) => v.bad === 0).map(([k]) => k);
  const notTranslated = langs.filter(([, v]) => v.bad > 0).map(([k]) => k);

  return (
    <Card>
      <CardHeader><CardTitle>Összesítés — összes futás ({s.total})</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={statusColor("succeeded")}>Sikeres: {ok}</Badge>
          <Badge variant="outline" className={statusColor("failed")}>Hibás: {bad}</Badge>
          {(s.byStatus[INFRA_STATUS] ?? 0) > 0 && (
            <Badge variant="outline" className={statusColor(INFRA_STATUS)}>
              Proxy hiba (nem Kylo): {s.byStatus[INFRA_STATUS]}
            </Badge>
          )}
          {Object.entries(s.byStatus)
            .filter(([k]) => k !== "succeeded" && k !== "failed" && k !== INFRA_STATUS)
            .map(([k, v]) => (
              <Badge key={k} variant="outline" className={statusColor(k)}>{k}: {v}</Badge>
            ))}
          <Badge variant="outline">Belépett: {s.loggedIn}</Badge>
          <Badge variant="outline" className={(s.reachedStripe ?? 0) > 0 ? "" : "text-destructive"}>
            Eljutott a fizetésig: {s.reachedStripe ?? 0}
          </Badge>
          <Badge variant="outline" className={(s.reachedProfile ?? 0) > 0 ? "" : "text-destructive"}>
            Eljutott a profil oldalig: {s.reachedProfile ?? 0}
          </Badge>

          {s.avgActions !== null && (
            <Badge variant="outline">Átlag {s.avgActions} lépés / futás</Badge>
          )}
        </div>

        <div>
          <div className="mb-2 font-medium">Miért buktak el?</div>
          {errs.length === 0 ? (
            <div className="text-muted-foreground">Nincs hibás futás.</div>
          ) : (
            <ul className="space-y-1">
              {errs.map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 border-b py-1 last:border-0">
                  <span>{k}</span>
                  <span className="font-mono text-muted-foreground">{v}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-2 font-medium">Fordítás nyelvenként (sikeres futások alapján)</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {langs.map(([lang, v]) => (
              <div key={lang} className="flex items-center justify-between gap-3 border-b py-1">
                <span className="font-mono">{lang}</span>
                <span>
                  {v.bad === 0 ? (
                    <Badge variant="outline" className={statusColor("succeeded")}>rendben</Badge>
                  ) : (
                    <Badge variant="outline" className={statusColor("failed")}>
                      hiányos ({v.bad}/{v.total} futás)
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Rendben: {translated.join(", ") || "—"} · Hiányos vagy angol fallback:{" "}
            {notTranslated.join(", ") || "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
