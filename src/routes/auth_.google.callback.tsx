import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { finishGmailOAuth } from "@/lib/gmail.functions";

export const Route = createFileRoute("/auth/google/callback")({
  component: GoogleCallbackPage,
});

function GoogleCallbackPage() {
  const search = Route.useSearch() as Record<string, string>;
  const code = search.code || "";
  const state = search.state || "";
  const oauthError = search.error || "";

  const callFinish = useServerFn(finishGmailOAuth);
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [workflowId, setWorkflowId] = useState<string>("");

  useEffect(() => {
    if (oauthError) {
      setStatus("error");
      setMessage(oauthError);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Hiányzó kód vagy state — a Google nem küldött adatot.");
      return;
    }
    (async () => {
      try {
        const redirectUri = `${window.location.origin}/auth/google/callback`;
        const res = await callFinish({ data: { code, state, redirectUri } });
        setStatus("ok");
        setEmail(res.email);
        setWorkflowId(res.workflowId);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, state, oauthError, callFinish]);

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold text-destructive">
            Gmail csatlakoztatás sikertelen
          </h1>
          <p className="text-sm text-muted-foreground break-words">{message}</p>
          <a
            href="/"
            className="inline-block rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Vissza
          </a>
        </div>
      </div>
    );
  }

  if (status === "ok") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold text-primary">
            Gmail sikeresen csatlakoztatva
          </h1>
          <p className="text-sm text-muted-foreground">
            Fiók: <span className="font-mono">{email}</span>
          </p>
          <a
            href={workflowId ? `/w/${workflowId}` : "/"}
            className="inline-block rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          >
            Vissza a workflow-hoz
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Gmail csatlakoztatás folyamatban…</h1>
        <p className="text-sm text-muted-foreground">
          A rendszer feldolgozza a Google válaszát.
        </p>
      </div>
    </div>
  );
}
