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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  ScrollText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

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

function normalizeBrowserUrl(rawUrl: string) {
  const url = rawUrl.trim();
  if (!url) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(url)) return `http://${url}`;
  return `https://${url}`;
}

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [textPanelOpen, setTextPanelOpen] = useState(false);
  const [pageText, setPageText] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const sendToWorker = useCallback((event: string, payload: Record<string, unknown>) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: "broadcast", event, payload });
  }, []);

  const sendViewportToWorker = useCallback(() => {
    const el = imgWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = Math.max(900, Math.min(1920, Math.floor(rect.width)));
    const h = Math.max(620, Math.min(1200, Math.floor(rect.height)));
    sendToWorker("viewport", { w, h });
  }, [sendToWorker]);

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
    ch.on("broadcast", { event: "ready" }, ({ payload }) => {
      const p = payload as { w?: number; h?: number };
      setStatus("active");
      if (p.w && p.h) setFrame((prev) => (prev ? { ...prev, w: p.w!, h: p.h! } : prev));
    });
    ch.on("broadcast", { event: "nav" }, ({ payload }) => {
      const p = payload as { url: string };
      setCurrentUrl(p.url);
      setUrlDraft(p.url);
      setPageText("");
    });
    ch.on("broadcast", { event: "pageText" }, ({ payload }) => {
      const p = payload as { text?: string };
      setPageText(p.text ?? "");
      setTextBusy(false);
      setTextPanelOpen(true);
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
    setPageText("");
    setTextBusy(false);
  }, [open, sessionId]);

  // ESC ne zárja be véletlenül — csak az X gomb
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
      if (isEditableTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        requestSelectAllAndText();
        return;
      }
      const key = workerKeyFromEvent(e);
      if (!key) return;
      if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        sendToWorker("key", { key });
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, sendToWorker]);

  // Egér-görgő → továbbítjuk a workernek (passzív listener helyett saját, hogy preventDefault menjen)
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ch = channelRef.current;
      if (!ch) return;
      void ch.send({
        type: "broadcast",
        event: "scroll",
        payload: { dx: e.deltaX, dy: e.deltaY },
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [open]);

  useEffect(() => {
    if (!open || !imgWrapRef.current) return;
    const ro = new ResizeObserver(() => sendViewportToWorker());
    ro.observe(imgWrapRef.current);
    window.setTimeout(sendViewportToWorker, 250);
    return () => ro.disconnect();
  }, [open, sessionId, textPanelOpen, sendViewportToWorker]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
      window.setTimeout(sendViewportToWorker, 250);
    } catch {
      toast.error("A teljes képernyő nem indítható ebben a böngészőben.");
    }
  }

  function requestPageText() {
    setTextBusy(true);
    setTextPanelOpen(true);
    sendToWorker("extractText", {});
    window.setTimeout(() => setTextBusy(false), 5000);
  }

  async function copyPageText() {
    if (!pageText) return;
    try {
      await navigator.clipboard.writeText(pageText);
      toast.success("Oldalszöveg másolva.");
    } catch {
      toast.error("Másolás sikertelen.");
    }
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
    const url = normalizeBrowserUrl(urlDraft);
    if (!url) return;
    setUrlDraft(url);
    sendToWorker("goto", { url });
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
    <div ref={rootRef} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
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
          placeholder="origo.hu vagy https://origo.hu"
          inputMode="url"
          className="h-8 flex-1 bg-zinc-900 border-white/10 text-sm text-white placeholder:text-white/40"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
          aria-label="Kicsinyítés"
          title="Kicsinyítés"
        >
          <ZoomOut className="size-4" />
        </Button>
        <span className="hidden w-12 text-center text-xs text-white/60 sm:inline">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => setZoom((z) => Math.min(1.75, Number((z + 0.25).toFixed(2))))}
          aria-label="Nagyítás"
          title="Nagyítás"
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={requestPageText}
          aria-label="Oldalszöveg megnyitása"
          title="Oldalszöveg megnyitása"
        >
          {textBusy ? <Loader2 className="size-4 animate-spin" /> : <ScrollText className="size-4" />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={() => setTextPanelOpen((v) => !v)}
          aria-label={textPanelOpen ? "Szövegpanel bezárása" : "Szövegpanel megnyitása"}
          title={textPanelOpen ? "Szövegpanel bezárása" : "Szövegpanel megnyitása"}
        >
          {textPanelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Teljes képernyő bezárása" : "Teljes képernyő"}
          title={isFullscreen ? "Teljes képernyő bezárása" : "Teljes képernyő"}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
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

      <div className="flex min-h-0 flex-1">
        {/* Böngésző-kép */}
        <div
          ref={imgWrapRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-auto bg-black"
        >
          {frame ? (
            <img
              src={frame.dataUrl}
              alt="Böngésző élő kép"
              className="cursor-crosshair object-contain"
              style={{
                width: zoom === 1 ? "100%" : `${frame.w * zoom}px`,
                maxWidth: zoom === 1 ? "100%" : "none",
                maxHeight: zoom === 1 ? "100%" : "none",
              }}
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

          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
            <Button
              size="icon-sm"
              variant="secondary"
              className="bg-zinc-900/90 text-white shadow-lg hover:bg-zinc-800"
              onClick={() => sendToWorker("scroll", { dx: 0, dy: -520 })}
              aria-label="Oldal feljebb görgetése"
              title="Oldal feljebb görgetése"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              className="bg-zinc-900/90 text-white shadow-lg hover:bg-zinc-800"
              onClick={() => sendToWorker("scroll", { dx: 0, dy: 520 })}
              aria-label="Oldal lejjebb görgetése"
              title="Oldal lejjebb görgetése"
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
        </div>

        {textPanelOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <ScrollText className="size-4 text-white/70" />
              <span className="text-sm font-medium">Oldalszöveg</span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="ml-auto text-white hover:bg-white/10"
                onClick={requestPageText}
                aria-label="Oldalszöveg frissítése"
                title="Oldalszöveg frissítése"
              >
                {textBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={copyPageText}
                disabled={!pageText}
                aria-label="Oldalszöveg másolása"
                title="Oldalszöveg másolása"
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <textarea
              readOnly
              value={textBusy && !pageText ? "Betöltés…" : pageText}
              placeholder="Nincs még beolvasott szöveg."
              className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
            />
          </aside>
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
