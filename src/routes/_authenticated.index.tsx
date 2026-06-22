import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Brain } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "KyloBrain — Workflow automatizáció" },
      {
        name: "description",
        content:
          "Tanítsd be böngészős workflow-jaidat természetes nyelven. A KyloBrain emberi viselkedéssel hajtja végre őket.",
      },
      { property: "og:title", content: "KyloBrain" },
      { property: "og:description", content: "Emberi viselkedésű böngésző-automatizáció." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  // Auto-open last workflow if any exists.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("workflows")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        navigate({ to: "/w/$workflowId", params: { workflowId: data.id }, replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Brain className="size-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight">KyloBrain</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Hozz létre egy új workflow-t a bal oldali sávban, és tanítsd be természetes
        nyelven, mit szeretnél automatizálni.
      </p>
    </div>
  );
}
