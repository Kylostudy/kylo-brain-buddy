import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Cookie, Globe, Lock, Unlock, RotateCcw } from "lucide-react";

import {
  getCookieJarStatus,
  setCookieJarLocked,
  clearCookieJar,
} from "@/lib/cookie-jar.functions";
import { Button } from "@/components/ui/button";

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "🌐";
  const cc = code.toUpperCase();
  const A = 0x1f1e6;
  return (
    String.fromCodePoint(A + cc.charCodeAt(0) - 65) +
    String.fromCodePoint(A + cc.charCodeAt(1) - 65)
  );
}

function relative(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "épp most";
  if (m < 60) return `${m} perce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} órája`;
  const d = Math.floor(h / 24);
  return `${d} napja`;
}

export function CookieJarBadge({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callStatus = useServerFn(getCookieJarStatus);
  const callSetLocked = useServerFn(setCookieJarLocked);
  const callClear = useServerFn(clearCookieJar);

  const { data } = useQuery({
    queryKey: ["cookie-jar", workflowId],
    queryFn: () => callStatus({ data: { workflowId } }),
    refetchInterval: 10000,
  });

  const toggleLock = useMutation({
    mutationFn: () =>
      callSetLocked({ data: { workflowId, locked: !(data?.locked ?? false) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cookie-jar", workflowId] });
      toast.success(
        data?.locked ? "Cookie jar védelem kikapcsolva." : "Cookie jar védelem bekapcsolva.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nem sikerült"),
  });

  const clear = useMutation({
    mutationFn: () => callClear({ data: { workflowId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cookie-jar", workflowId] });
      qc.invalidateQueries({ queryKey: ["credentials", workflowId] });
      toast.success("Cookie jar nullázva. Új warmupot indíthatsz.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nem sikerült"),
  });

  const empty = !data?.hasCookies && !data?.country;

  return (
    <div className="border-t px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cookie jar
        </h2>
        {data?.locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            <Lock className="size-3" /> zárolva
          </span>
        )}
      </div>

      {empty ? (
        <div className="rounded-md border border-dashed bg-background/40 p-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Cookie className="size-3.5 opacity-60" />
            <span>Még üres. Indíts egy warmup futást — a begyűjtött sütik ide kerülnek titkosítva.</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-background/40 p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-base leading-none">{countryFlag(data?.country ?? null)}</span>
            <div className="flex flex-col">
              <span className="font-semibold">
                {data?.country ?? "?"} · {data?.cookies ?? 0} süti
              </span>
              <span className="text-[10px] text-muted-foreground">
                {data?.domains ?? 0} domain
                {data?.updatedAt ? ` · frissítve ${relative(data.updatedAt)}` : ""}
              </span>
            </div>
          </div>

          <div className="flex gap-1.5 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 gap-1"
              onClick={() => toggleLock.mutate()}
              disabled={toggleLock.isPending || !data?.country}
              title={
                data?.locked
                  ? "Kikapcsolja a védelmet — más országú proxyk is választhatók lesznek (csak figyelmeztetés)."
                  : "Bekapcsolja a védelmet — csak a cookie jar országának megfelelő proxy lesz választható."
              }
            >
              {data?.locked ? (
                <>
                  <Unlock className="size-3" /> feloldás
                </>
              ) : (
                <>
                  <Lock className="size-3" /> zárolás
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (
                  !confirm(
                    "Biztosan nullázod a cookie jart? Az összes titkosított süti törlődik és a védelem kikapcsol.",
                  )
                )
                  return;
                clear.mutate();
              }}
              disabled={clear.isPending}
              title="Törli az összes tárolt sütit és leveszi az ország címkét."
            >
              <RotateCcw className="size-3" /> nullázás
            </Button>
          </div>
          {data?.country && !data?.locked && (
            <p className="text-[10px] text-muted-foreground/80">
              <Globe className="mr-1 inline size-3" />
              Csak figyelmeztetés — más országú proxyt is választhatsz, de a fingerprint eltérése miatt a platform kitilthat.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
