// Kylo Vault — publikus letöltő oldal: /s/:token
// Nincs bejelentkezés, csak a token (és ha van, a jelszó).

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FileEntry = { path: string; size: number };
type ShareState = {
  ok: true;
  name: string;
  kind: "file" | "dir";
  size: number;
  files: FileEntry[];
  allowDownload: boolean;
  expiresAt: string;
  downloadKey: string | null;
};

export const Route = createFileRoute("/s/$token")({
  component: SharePage,
  head: () => ({
    meta: [
      { title: "Megosztott fájl — Kylo Vault" },
      { name: "description", content: "Biztonságos, lejáró megosztás a Kylo Vault széfből." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Megosztott fájl — Kylo Vault" },
      { property: "og:description", content: "Biztonságos, lejáró megosztás a Kylo Vault széfből." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function SharePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<ShareState | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(pw: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/s/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pw ? { password: pw } : {}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setState(data as ShareState);
        setNeedsPassword(false);
      } else if (res.status === 401 && data.needsPassword) {
        setNeedsPassword(true);
        setError(data.error ?? null);
      } else if (res.status === 429) {
        setError("Túl sok próbálkozás. Próbáld újra pár perc múlva.");
      } else {
        setError(data.error ?? "Ez a link már nem érvényes.");
      }
    } catch {
      setError("Nem sikerült kapcsolódni. Próbáld újra.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const dl = (relative?: string, zip = false) =>
    `/api/public/s/${encodeURIComponent(token)}/dl?k=${encodeURIComponent(
      state?.downloadKey ?? "",
    )}${zip ? "&zip=1" : ""}${relative ? `&f=${encodeURIComponent(relative)}` : ""}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Kylo Vault — megosztás</h1>

        {loading && <p className="mt-4 text-sm text-muted-foreground">Betöltés…</p>}

        {!loading && needsPassword && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void load(password);
            }}
          >
            <p className="text-sm text-muted-foreground">
              Ez a megosztás jelszóval védett.
            </p>
            <Input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Jelszó"
              maxLength={200}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={!password}>
              Megnyitás
            </Button>
          </form>
        )}

        {!loading && !needsPassword && error && (
          <p className="mt-4 text-sm text-muted-foreground">{error}</p>
        )}

        {!loading && state && (
          <div className="mt-6 space-y-4">
            <div>
              <p className="text-base font-medium text-foreground">{state.name}</p>
              <p className="text-sm text-muted-foreground">
                {state.kind === "dir"
                  ? `${state.files.length} fájl · ${formatBytes(state.size)}`
                  : formatBytes(state.size)}{" "}
                · érvényes eddig:{" "}
                {new Date(state.expiresAt).toLocaleString("hu-HU")}
              </p>
            </div>

            {!state.allowDownload && (
              <p className="text-sm text-muted-foreground">
                Ehhez a megosztáshoz a letöltés ki van kapcsolva.
              </p>
            )}

            {state.allowDownload && state.kind === "file" && (
              <Button asChild>
                <a href={dl()}>Letöltés</a>
              </Button>
            )}

            {state.allowDownload && state.kind === "dir" && (
              <>
                <Button asChild>
                  <a href={dl(undefined, true)}>Minden letöltése ZIP-ben</a>
                </Button>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {state.files.map((f) => (
                    <li key={f.path} className="flex items-center justify-between gap-4 px-3 py-2">
                      <span className="truncate text-sm text-foreground">{f.path}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(f.size)}
                      </span>
                      <a
                        className="shrink-0 text-sm text-primary underline-offset-2 hover:underline"
                        href={dl(f.path)}
                      >
                        Letöltés
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
