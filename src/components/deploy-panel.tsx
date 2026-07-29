import { useEffect, useState } from "react";
import { Rocket, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DeployRequest = {
  id: string;
  note: string | null;
  status: string;
  worker_id: string | null;
  active_color: string | null;
  log: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Sorban áll",
  running: "Folyamatban",
  succeeded: "Sikeres",
  failed: "Hiba",
  cancelled: "Megszakítva",
};

function isAutoDeploy(note: string | null) {
  return (note ?? "").toLowerCase().includes("automatikus frissítés");
}

function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="size-4 text-destructive" />;
  if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  return <Loader2 className="size-4 text-muted-foreground" />;
}

export function DeployPanel() {
  const [items, setItems] = useState<DeployRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("worker_deploy_requests")
      .select(
        "id,note,status,worker_id,active_color,log,error,created_at,started_at,finished_at",
      )
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as DeployRequest[]);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const active = items.find((i) => i.status === "pending" || i.status === "running");

  const request = async () => {
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("worker_deploy_requests").insert({
      requested_by: auth.user?.id ?? null,
      note: "Frissítés a Brain felületről",
      status: "pending",
    });
    setBusy(false);
    if (error) {
      toast.error("Nem sikerült elindítani", { description: error.message });
      return;
    }
    toast.success("Frissítés kérve", {
      description:
        "A VPS egy percen belül elindítja. A futó munkák nem szakadnak félbe.",
    });
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Rocket className="size-4" /> Frissítés (zéró leállás)
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Egy gomb: a VPS lehúzza az új kódot, felépíti a tartalék készletet, majd
            átkapcsol rá. A futó munkák végigfutnak.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" onClick={request} disabled={busy || !!active}>
            {busy || active ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            {active ? "Frissítés folyamatban" : "Frissítés indítása"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">Még nem volt frissítés.</p>
        )}
        {items.map((it) => (
          <div key={it.id} className="rounded-md border p-2 text-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOpenId(openId === it.id ? null : it.id)}
            >
              <span className="flex items-center gap-2">
                <StatusIcon status={it.status} />
                {STATUS_LABEL[it.status] ?? it.status}
                {it.active_color && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    aktív: {it.active_color}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(it.created_at).toLocaleString("hu-HU")}
              </span>
            </button>
            {openId === it.id && (
              <div className="mt-2 space-y-2">
                {it.error && (
                  <p className="rounded bg-destructive/10 p-2 text-xs">{it.error}</p>
                )}
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {it.log?.trim() || "Még nincs napló."}
                </pre>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
