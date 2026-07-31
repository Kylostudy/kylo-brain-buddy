import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Emberi nyelvű AI-elemzés doboz. Szándékosan általános: bármelyik workflow
 * riportjához használható, csak az `explain` függvényt kell átadni.
 */
export function AiExplanationBlock({
  runId,
  initial,
  enabled,
  explain,
  title = "Elemzés emberi nyelven",
}: {
  runId: string;
  initial?: { text?: string; generated_at?: string } | null;
  enabled: boolean;
  explain: (args: { data: { runId: string; force: boolean } }) => Promise<{
    text: string;
    generated_at: string | null;
  }>;
  title?: string;
}) {
  const [text, setText] = useState<string | null>(initial?.text ?? null);
  const [at, setAt] = useState<string | null>(initial?.generated_at ?? null);

  const mut = useMutation({
    mutationFn: (force: boolean) => explain({ data: { runId, force } }),
    onSuccess: (d) => {
      setText(d.text);
      setAt(d.generated_at);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const asked = useRef(false);
  useEffect(() => {
    if (enabled && !text && !asked.current) {
      asked.current = true;
      mut.mutate(false);
    }
  }, [enabled, text, mut]);

  return (
    <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-sky-100">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase">{title}</div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={mut.isPending}
          onClick={() => mut.mutate(true)}
        >
          {mut.isPending ? "Készül…" : "Újragenerálás"}
        </Button>
      </div>
      {text ? (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text.replace(/\*\*/g, "")}</div>
      ) : (
        <div className="text-xs text-sky-200/80">
          {mut.isPending ? "Az elemzés készül, ez pár másodperc…" : "Még nincs elemzés."}
        </div>
      )}
      {at && <div className="mt-1 text-[10px] text-sky-200/60">Készült: {new Date(at).toLocaleString("hu-HU")}</div>}
    </div>
  );
}
