import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listKyloTestAccounts,
  revealKyloTestPassword,
  deleteKyloTestAccount,
} from "@/lib/kylo-signup.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function statusLabel(s: string) {
  if (s === "registered") return "regisztrált";
  if (s === "failed") return "hibás";
  return "függőben";
}

export function TestAccountsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listKyloTestAccounts);
  const revealFn = useServerFn(revealKyloTestPassword);
  const deleteFn = useServerFn(deleteKyloTestAccount);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["kylo-test-accounts"],
    queryFn: () => listFn({}),
    refetchInterval: 30000,
  });

  const reveal = useMutation({
    mutationFn: (id: string) => revealFn({ data: { id } }),
    onSuccess: (res, id) => setRevealed((p) => ({ ...p, [id]: res.password })),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Teszt fiók törölve");
      qc.invalidateQueries({ queryKey: ["kylo-test-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accounts = data?.accounts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Teszt fiókok (alias e-mail + jelszó)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Minden Sign Up futáshoz elmentjük az alias e-mailt és a jelszót. Ha a
          regisztrációs folyamat már működik, a további funkcionális teszteknél
          ezekkel a párokkal lehet belépni új regisztráció helyett.
        </p>
        {isLoading ? (
          <div className="text-muted-foreground">Betöltés…</div>
        ) : accounts.length === 0 ? (
          <div className="text-muted-foreground">Még nincs mentett teszt fiók.</div>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <span className="font-mono">{a.email}</span>
                <Badge
                  variant={
                    a.status === "registered"
                      ? "default"
                      : a.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {statusLabel(a.status)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  #{a.run_index ?? "?"} · {a.country ?? "?"} · {a.lang ?? "?"} ·{" "}
                  {a.skin ?? "?"}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {revealed[a.id] ? (
                    <>
                      <span className="font-mono">{revealed[a.id]}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard?.writeText(
                            `${a.email}\t${revealed[a.id]}`,
                          );
                          toast.success("Másolva");
                        }}
                      >
                        Másol
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reveal.isPending}
                      onClick={() => reveal.mutate(a.id)}
                    >
                      Jelszó mutatása
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(a.id)}
                  >
                    Törlés
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
