import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Flame, UserPlus, Upload, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  listRedditWorkflows,
  importRedditAccounts,
  startRedditTask,
  setRedditQuarantine,
} from "@/lib/reddit-accounts.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function RedditAccountsPanel() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const listFn = useServerFn(listRedditWorkflows);
  const importFn = useServerFn(importRedditAccounts);
  const taskFn = useServerFn(startRedditTask);
  const quarantineFn = useServerFn(setRedditQuarantine);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["reddit-workflows"],
    queryFn: () => listFn(),
  });

  const importMut = useMutation({
    mutationFn: (t: string) => importFn({ data: { text: t } }),
    onSuccess: (res) => {
      toast.success(`${res.imported} fiók mentve, ${res.failed} hiba.`);
      for (const r of res.results.filter((x) => !x.ok)) {
        toast.error(`${r.line} — ${r.message}`);
      }
      setText("");
      qc.invalidateQueries({ queryKey: ["reddit-workflows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const taskMut = useMutation({
    mutationFn: (vars: { task_type: "reddit_register" | "reddit_warmup" }) =>
      taskFn({
        data: { workflow_ids: selected, task_type: vars.task_type, duration_min: 30 },
      }),
    onSuccess: (res) => {
      toast.success(`${res.queued} futás sorba állítva.`);
      qc.invalidateQueries({ queryKey: ["reddit-workflows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quarantineMut = useMutation({
    mutationFn: (vars: { days: number }) =>
      quarantineFn({
        data: {
          workflow_ids: selected,
          days: vars.days,
          reason: vars.days > 0 ? "gyanús platform-jelzés (kézi karantén)" : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.until
          ? `${res.updated} fiók karanténba került eddig: ${new Date(res.until).toLocaleDateString("hu-HU")}`
          : `${res.updated} fiók karanténja feloldva.`,
      );
      qc.invalidateQueries({ queryKey: ["reddit-workflows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isQuarantined = (until: string | null) =>
    !!until && new Date(until) > new Date();

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const readyForRegister = rows.filter((r) => r.has_cookies && !r.username);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Meglévő Reddit fiókok importálása
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Soronként egy fiók, ebben a formában (elválasztó: pontosvessző, függőleges
            vonal vagy tabulátor):
            <br />
            <code className="text-xs">ORSZÁGKÓD ; felhasználónév ; jelszó ; e-mail (nem kötelező)</code>
            <br />
            Például: <code className="text-xs">NL ; quiet_otter_412 ; Titk0sJelszo! ; alias@gmail.com</code>
            <br />A jelszó titkosítva kerül tárolásra, és a fiók automatikusan
            hozzákapcsolódik az adott ország proxyjához.
          </p>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"NL ; felhasznalonev ; jelszo\nGB ; masik_nev ; masik_jelszo"}
          />
          <Button
            onClick={() => importMut.mutate(text)}
            disabled={!text.trim() || importMut.isPending}
          >
            {importMut.isPending ? "Importálás…" : "Fiókok importálása"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reddit workflow-k állapota</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Nincs Reddit workflow.</p>
          )}
          <div className="space-y-1">
            {rows.map((r) => (
              <div
                key={r.workflow_id}
                className="flex items-center gap-3 rounded-md border p-2 text-sm"
              >
                <Checkbox
                  id={r.workflow_id}
                  checked={selected.includes(r.workflow_id)}
                  onCheckedChange={() => toggle(r.workflow_id)}
                />
                <Label htmlFor={r.workflow_id} className="flex-1 cursor-pointer font-medium">
                  {r.name}
                </Label>
                <Badge variant="outline">{r.country ?? "nincs proxy"}</Badge>
                <Badge variant={r.has_cookies ? "default" : "secondary"}>
                  {r.has_cookies ? "süti ✓" : "nincs süti"}
                </Badge>
                <Badge variant={r.username ? "default" : "secondary"}>
                  {r.username ? r.username : "nincs fiók"}
                </Badge>
                {isQuarantined(r.quarantined_until) && (
                  <Badge variant="destructive" title={r.quarantine_reason ?? ""}>
                    karantén ·{" "}
                    {new Date(r.quarantined_until!).toLocaleDateString("hu-HU")}
                  </Badge>
                )}
                {r.warmup_status && (
                  <Badge variant="outline">
                    {r.warmup_status} · {r.warmup_days_completed} nap
                  </Badge>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() =>
                setSelected(readyForRegister.map((r) => r.workflow_id))
              }
            >
              Kijelölés: regisztrációra kész ({readyForRegister.length})
            </Button>
            <Button
              onClick={() => taskMut.mutate({ task_type: "reddit_register" })}
              disabled={selected.length === 0 || taskMut.isPending}
            >
              <UserPlus className="mr-2 h-4 w-4" /> Reddit regisztráció indítása
            </Button>
            <Button
              variant="secondary"
              onClick={() => taskMut.mutate({ task_type: "reddit_warmup" })}
              disabled={selected.length === 0 || taskMut.isPending}
            >
              <Flame className="mr-2 h-4 w-4" /> Fiók-melegítés indítása (30 perc)
            </Button>
            <Button
              variant="destructive"
              onClick={() => quarantineMut.mutate({ days: 14 })}
              disabled={selected.length === 0 || quarantineMut.isPending}
            >
              <ShieldAlert className="mr-2 h-4 w-4" /> Karantén 14 napra
            </Button>
            <Button
              variant="outline"
              onClick={() => quarantineMut.mutate({ days: 0 })}
              disabled={selected.length === 0 || quarantineMut.isPending}
            >
              <ShieldCheck className="mr-2 h-4 w-4" /> Karantén feloldása
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
