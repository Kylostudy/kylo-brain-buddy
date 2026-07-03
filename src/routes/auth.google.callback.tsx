import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/google/callback")({
  component: GoogleCallbackPage,
});

function GoogleCallbackPage() {
  const search = Route.useSearch() as Record<string, string>;
  const code = search.code || "";
  const error = search.error || "";

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold text-destructive">
            Google hitelesítés sikertelen
          </h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Google hitelesítés folyamatban…</h1>
        <p className="text-sm text-muted-foreground">
          A rendszer feldolgozza a kódot. Ez az oldal a jövőben automatikusan
          elmenti az OAuth tokent a workflow-hoz.
        </p>
        {code && (
          <div className="rounded-lg border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Kapott kód (rövidítve):</p>
            <code className="text-xs break-all">
              {code.slice(0, 12)}…
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
