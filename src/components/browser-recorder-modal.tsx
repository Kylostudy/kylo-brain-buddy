// Teljes képernyős böngésző-felvevő modál.
//
// Működés:
// 1. A felhasználó a chatben megnyom egy Record gombot → startRecording().
// 2. Megnyílik ez a modál, létrejön egy Supabase Realtime channel (`record:<sessionId>`).
// 3. A VPS worker felveszi a session-t (claim), és broadcaston küldi:
//      - `frame`  { dataUrl, w, h, ts }      — JPEG screenshot
//      - `nav`    { url }                    — navigáció a worker oldalán
//      - `action` { action: RecordedAction } — egy felvett akció
// 4. A felhasználó kattintásait/gépeléseit a modál ugyanezen a channelen visszaküldi:
//      - `click`  { x, y }                   — normalizált 0..1 koordináta
//      - `type`   { text }
//      - `key`    { key }
//      - `scroll` { dx, dy }
//      - `goto`   { url }
//      - `stop`   { save: boolean }
// 5. Mentésnél (✓) → saveRecording() menti az akciókat a workflow specbe.
//    Elvetésnél (X) → cancelRecording().

import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, X, Loader2, Camera, ArrowLeft, ArrowRight, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelRecording,
  saveRecording,
} from "@/lib/recording.functions";
import type { RecordedAction } from "@/lib/chat.functions";

type Props = {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
};

type Frame = { dataUrl: string; w: number; h: number; ts: number };

export function BrowserRecorderModal({ open, sessionId, onClose }: Props) {
  const callSave = useServerFn(saveRecording);
  const callCancel = useServerFn(cancelRecording);

  const [status, setStatus] = useState<
    "requested" | "active" | "completed" | "cancelled" | "failed"
  >("requested");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [urlDraft, setUrlDraft] = useState<string>("");
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  // Realtime feliratkozás a session csatornájára
  useEffect(() => {
    if (!open || !sessionId) return;
    const ch = supabase.channel(`record:${sessionId}`, {
      config: { broadcast: { self: false } },
    });

    ch.on("broadcast", { event: "frame" }, ({ payload }) => {
      const p = payload as Frame;
      setFrame(p);
    });
    ch.on("broadcast", { event: "nav" }, ({ payload }) => {
      const p = payload as { url: string };
      setCurrentUrl(p.url);
      setUrlDraft(p.url);
    });
    ch.on("broadcast", { event: "action" }, ({ payload }) => {
      const p = payload as { action: RecordedAction };
      setActions((prev) => [...prev, p.action]);
    });
    ch.on("broadcast", { event: "status" }, ({ payload }) => {
      const p = payload as { status: typeof status; error?: string };
      setStatus(p.status);
      if (p.error) toast.error(p.error);
    });

    ch.subscribe();
    channelRef.current = ch;
    return () => {
      ch.unsubscribe();
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [open, sessionId]);

  // Postgres-szintű státusz figyelés (claim → active)
  useEffect(() => {
    if (!open || !sessionId) return;
    const ch = supabase
      .channel(`record-row:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "recording_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (msg) => {
          const row = msg.new as { status?: typeof status };
          if (row.status) setStatus(row.status);
        },
      )
      .subscribe();
    return () => {
      ch.unsubscribe();
      void supabase.removeChannel(ch);
    };
  }, [open, sessionId]);

  // Reset belépéskor
  useEffect(() => {
    if (!open) return;
    setStatus("requested");
    setFrame(null);
    setCurrentUrl("");
    setUrlDraft("");
    setActions([]);
  }, [open, sessionId]);

  // ESC ne zárja be véletlenül — csak az X gomb
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  function sendToWorker(event: string, payload: Record<string, unknown>) {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event, payload });
  }

  function handleFrameClick(e: React.MouseEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    sendToWorker("click", { x, y });
  }

  function handleType(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const txt = (e.target as HTMLInputElement).value;
      sendToWorker("type", { text: txt + "\n" });
      (e.target as HTMLInputElement).value = "";
      e.preventDefault();
    }
  }

  function handleNav() {
    if (!urlDraft.trim()) return;
    sendToWorker("goto", { url: urlDraft.trim() });
  }

  async function handleSave() {
    if (!sessionId) return;
    setBusy(true);
    try {
      sendToWorker("stop", { save: true });
      await callSave({ data: { sessionId, actions } });
      toast.success(`Felvétel mentve (${actions.length} lépés).`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mentés sikertelen");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!sessionId) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      sendToWorker("stop", { save: false });
      await callCancel({ data: { sessionId } });
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
      onClose();
    }
  }

  const statusLabel = useMemo(() => {
    switch (status) {
      case "requested":
        return "Várakozás a workerre…";
      case "active":
        return "Élő — kattints/gépelj a böngészőben";
      case "completed":
        return "Kész";
      case "cancelled":
        return "Megszakítva";
      case "failed":
        return "Hiba";
    }
  }, [status]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* Felső sáv: cím-sor szerű URL bar */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-950 px-3 py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => sendToWorker("back", {})}
          aria-label="Vissza"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => sendToWorker("forward", {})}
          aria-label="Előre"
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => sendToWorker("reload", {})}
          aria-label="Újratöltés"
        >
          <RotateCw className="size-4" />
        </Button>
        <Input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleNav();
            }
          }}
          placeholder="https://…"
          className="h-8 flex-1 bg-zinc-900 border-white/10 text-sm text-white placeholder:text-white/40"
        />
        <span className="hidden md:inline px-2 text-xs text-white/60">
          {statusLabel} · {actions.length} lépés
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={handleCancel}
          disabled={busy}
          aria-label="Felvétel elvetése"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          <span className="ml-1 hidden md:inline">Elvet</span>
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={handleSave}
          disabled={busy || actions.length === 0}
          aria-label="Mentés"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          <span className="ml-1 hidden md:inline">Mentés ({actions.length})</span>
        </Button>
      </div>

      {/* Böngésző-kép */}
      <div
        ref={imgWrapRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
      >
        {frame ? (
          <img
            src={frame.dataUrl}
            alt="Böngésző élő kép"
            className="max-h-full max-w-full cursor-crosshair object-contain"
            onClick={handleFrameClick}
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <Camera className="size-10 opacity-50" />
            <div className="text-sm">
              {status === "requested"
                ? "Várjuk, hogy a worker felvegye a felvételt…"
                : "Még nem érkezett képkocka a workertől."}
            </div>
            <div className="text-xs text-white/40">
              Session: <code>{sessionId}</code>
            </div>
          </div>
        )}
      </div>

      {/* Alsó sáv: rejtett input a gépeléshez */}
      <div className="flex items-center gap-2 border-t border-white/10 bg-zinc-950 px-3 py-2">
        <span className="text-xs text-white/50">Gépelés:</span>
        <input
          type="text"
          onKeyDown={handleType}
          placeholder="Írj ide és nyomj Entert — a worker böngészőjébe megy"
          className="flex-1 bg-zinc-900 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
        />
        <span className="text-xs text-white/40">
          Tipp: a képre kattintva navigálsz; az URL sáv navigál URL-re.
        </span>
      </div>
    </div>
  );
}
