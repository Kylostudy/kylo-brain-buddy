import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Brain, Bot } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useModule } from "@/lib/module/provider";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Kylo — Workflow automatizáció" },
      {
        name: "description",
        content:
          "Tanítsd be böngészős workflow-jaidat természetes nyelven. Brain emberi viselkedéssel, Audit determinisztikus tesztrobotként hajtja végre őket.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { module, meta } = useModule();
  const Icon = module === "brain" ? Brain : Bot;

  // Auto-open last workflow if any exists — modul-szerint szűrve.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("workflows")
        .select("id")
        .eq("module", module)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        navigate({ to: "/w/$workflowId", params: { workflowId: data.id }, replace: true });
      }
    })();
  }, [navigate, module]);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="size-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight">{meta.fullName}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{meta.tagline}</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Hozz létre egy új workflow-t a bal oldali sávban, és tanítsd be természetes
        nyelven, mit szeretnél automatizálni.
      </p>
    </div>
  );
}

