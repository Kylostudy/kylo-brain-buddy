import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAuditQaSummary } from "@/lib/audit-qa.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/40",
  major: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  minor: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/40",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  failed: "bg-red-500/15 text-red-400 border-red-500/40",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/40",
  queued: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
};

export function QaSummaryCard() {
  const fn = useServerFn(getAuditQaSummary);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-qa-summary"],
    queryFn: () => fn(),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Összesítés</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Számolás…</CardContent>
      </Card>
    );
  }
  if (!data || data.total === 0) return null;

  const langs = Object.entries(data.byLang).sort((a, b) => b[1].total - a[1].total);
  const cats = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Összesítés — összes futás ({data.total})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.byStatus).map(([k, v]) => (
            <Badge key={k} variant="outline" className={STATUS_COLOR[k] ?? ""}>
              {k}: {v}
            </Badge>
          ))}
          <Badge variant="outline">Bejárt oldal: {data.totalPages}</Badge>
          <Badge variant="outline">Költség: ${data.totalCostUsd.toFixed(2)}</Badge>
          <Badge variant="outline">Nyitott hiba: {data.openIssues}</Badge>
        </div>

        <div>
          <div className="mb-1 text-xs uppercase text-muted-foreground">Hibák súlyosság szerint</div>
          <div className="flex flex-wrap gap-2">
            {["critical", "major", "minor", "info"].map((s) => (
              <Badge key={s} variant="outline" className={SEVERITY_COLOR[s]}>
                {s}: {data.bySeverity[s] ?? 0}
              </Badge>
            ))}
          </div>
        </div>

        {langs.length > 0 && (
          <div>
            <div className="mb-1 text-xs uppercase text-muted-foreground">Nyelvenkénti bontás</div>
            <div className="flex flex-wrap gap-2">
              {langs.map(([lang, v]) => (
                <Badge
                  key={lang}
                  variant="outline"
                  className={v.critical > 0 ? SEVERITY_COLOR.critical : ""}
                  title={`${v.total} hiba, ebből ${v.critical} kritikus`}
                >
                  {lang}: {v.total}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {cats.length > 0 && (
          <div>
            <div className="mb-1 text-xs uppercase text-muted-foreground">Kategóriák</div>
            <div className="flex flex-wrap gap-2">
              {cats.map(([c, n]) => (
                <Badge key={c} variant="secondary">
                  {c}: {n}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
