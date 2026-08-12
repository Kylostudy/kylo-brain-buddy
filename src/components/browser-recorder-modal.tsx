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
  Cookie,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MailCheck,
  Maximize2,
  Minimize2,
  MousePointerClick,
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
import { findGmailConfirmationLink } from "@/lib/gmail.functions";
import { normalizeRecordingStartUrl } from "@/lib/recording-url";
import type { RecordedAction } from "@/lib/chat.functions";

type Props = {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  // 'record' = login flow felvétele (a végén Mentés gomb menti a lépéseket).
  // 'browse' = élő kézi böngészés (Mentés gomb rejtve, csak süti-mentés + Bezár).
  mode?: "record" | "browse";
};

type Frame = { dataUrl: string; w: number; h: number; ts: number };

function normalizeBrowserUrl(rawUrl: string) {
  return normalizeRecordingStartUrl(rawUrl, undefined) ?? "";
}

export function BrowserRecorderModal({ open, sessionId, onClose, mode = "record" }: Props) {
  const isBrowseMode = mode === "browse";
  const callSave = useServerFn(saveRecording);
  const callCancel = useServerFn(cancelRecording);
  const callFindGmailConfirmationLink = useServerFn(findGmailConfirmationLink);

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
  const [cookieBusy, setCookieBusy] = useState(false);
  const [gmailConfirmBusy, setGmailConfirmBusy] = useState(false);
  const [kyloUnlockBusy, setKyloUnlockBusy] = useState(false);
  const [inputStatus, setInputStatus] = useState("");
  // A státusz-sáv ne maradjon ott örökre (eltakarhatja a Bezár gombot).
  useEffect(() => {
    if (!inputStatus) return;
    const t = window.setTimeout(() => setInputStatus(""), 3000);
    return () => window.clearTimeout(t);
  }, [inputStatus]);
  // Jelszó-beküldés: a Bitwarden-féle bonyolult jelszót nem lehet emberként
  // gépelni, ezért egy mezőbe beillesztve, egy lépésben küldjük a workernek.
  const [secretOpen, setSecretOpen] = useState(false);
  const [secretValue, setSecretValue] = useState("");
  const [secretBusy, setSecretBusy] = useState(false);
  // Hosszú szöveg (pl. LinkedIn poszt) emberi tempójú begépelése: te kézzel
  // belépsz, rákattintasz a szerkesztőmezőre, a worker onnantól gépel.
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyValue, setStoryValue] = useState("");
  const [storyBusy, setStoryBusy] = useState(false);

  const [failureReason, setFailureReason] = useState("");
  const [workerTimeout, setWorkerTimeout] = useState(false);
  const [lockedFrameSize, setLockedFrameSize] = useState<{ w: number; h: number } | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const typeInputRef = useRef<HTMLInputElement | null>(null);
  const clickInFlightRef = useRef(false);
  const clickTimeoutRef = useRef<number | null>(null);
  const secretTimeoutRef = useRef<number | null>(null);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const clearClickInFlight = useCallback(() => {
    clickInFlightRef.current = false;
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
  }, []);

  const sendToWorker = useCallback((event: string, payload: Record<string, unknown>) => {
    const ch = channelRef.current;
    if (!ch) return null;
    return ch.send({ type: "broadcast", event, payload });
  }, []);

  // Realtime feliratkozás a session csatornájára
  useEffect(() => {
    if (!open || !sessionId) return;
    const ch = supabase.channel(`record:${sessionId}`, {
      config: { broadcast: { self: false, ack: true } },
    });

    ch.on("broadcast", { event: "frame" }, ({ payload }) => {
      const p = payload as Frame;
      setLockedFrameSize((prev) => prev ?? { w: p.w, h: p.h });
      setFrame(p);
      // Visszacsatlakozáskor a "ready" már rég elment — ha jön kép, él a munkamenet.
      setStatus((prev) => (prev === "requested" ? "active" : prev));
      setWorkerTimeout(false);
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
    ch.on("broadcast", { event: "navError" }, ({ payload }) => {
      const p = payload as { url?: string; message?: string };
      toast.error(
        `Nem sikerült megnyitni: ${p.url || "ismeretlen cím"}${p.message ? ` — ${p.message}` : ""}`,
      );
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
    ch.on("broadcast", { event: "inputAck" }, ({ payload }) => {
      const p = payload as { kind?: string; status?: string; x?: number; y?: number; target?: string };
      if (p.kind === "secret") {
        if (p.status === "received") {
          setInputStatus(p.target ?? "A worker átvette a jelszót, beillesztés folyamatban…");
          // A kézbesítés megtörtént: az első időkorlát helyett innentől a
          // tényleges mezőművelet befejezésére várunk.
          if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
          secretTimeoutRef.current = window.setTimeout(() => {
            secretTimeoutRef.current = null;
            setSecretBusy(false);
            setInputStatus("A worker átvette a jelszót, de a mező nem fejezte be a beillesztést.");
            toast.error("A távoli mező nem fogadta el a jelszót. Kattints a mező közepére, majd próbáld újra.");
          }, 20000);
          return;
        }
        if (secretTimeoutRef.current !== null) {
          window.clearTimeout(secretTimeoutRef.current);
          secretTimeoutRef.current = null;
        }
        setSecretBusy(false);
        if (p.status === "done") {
          setSecretValue("");
          setSecretOpen(false);
          setInputStatus(`✓ ${p.target ?? "A jelszó bekerült a kijelölt mezőbe."}`);
          toast.success("A jelszó bekerült a távoli böngészőbe.");
        } else {
          setInputStatus(`Jelszóbeillesztési hiba: ${p.target ?? "kattints újra a jelszómezőre"}`);
          toast.error(p.target ?? "Nem található a jelszómező. Kattints rá, majd próbáld újra.");
        }
        return;
      }
      if (p.kind === "click") {
        const targetStr = p.target ? ` → ${p.target}` : "";
        if (p.status === "done" || p.status === "busy") clearClickInFlight();
        setInputStatus(
          p.status === "done"
            ? `✓ Kattintva (${p.x ?? "?"}, ${p.y ?? "?"})${targetStr}`
            : p.status === "busy"
            ? `Várj: az előző kattintás még fut (${p.x ?? "?"}, ${p.y ?? "?"})`
            : `→ Worker fogadta (${p.x ?? "?"}, ${p.y ?? "?"})${targetStr}`,
        );
      }
    });

    ch.on("broadcast", { event: "inputError" }, ({ payload }) => {
      const p = payload as { error?: string };
      clearClickInFlight();
      setInputStatus(`Kattintási hiba: ${p.error ?? "ismeretlen"}`);
    });
    ch.on("broadcast", { event: "kyloUnlockAck" }, ({ payload }) => {
      const p = payload as { clicks?: number; target?: string; url?: string };
      setKyloUnlockBusy(false);
      clearClickInFlight();
      const target = p.target ? ` → ${p.target}` : "";
      setInputStatus(`✓ Kylo logó ${p.clicks ?? 7}× elkattintva${target}`);
      if (p.url) {
        setCurrentUrl(p.url);
        setUrlDraft(p.url);
      }
    });
    ch.on("broadcast", { event: "kyloUnlockError" }, ({ payload }) => {
      const p = payload as { error?: string };
      setKyloUnlockBusy(false);
      clearClickInFlight();
      setInputStatus(`Kylo 7 kattintás hiba: ${p.error ?? "ismeretlen"}`);
    });
    ch.on("broadcast", { event: "gmailConfirmAck" }, ({ payload }) => {
      const p = payload as { url?: string; subject?: string };
      setGmailConfirmBusy(false);
      setInputStatus(`✓ Megerősítő link megnyitva${p.subject ? ` — ${p.subject}` : ""}`);
      if (p.url) {
        setCurrentUrl(p.url);
        setUrlDraft(p.url);
      }
    });
    ch.on("broadcast", { event: "gmailConfirmError" }, ({ payload }) => {
      const p = payload as { error?: string };
      setGmailConfirmBusy(false);
      setInputStatus(`E-mail megerősítés hiba: ${p.error ?? "ismeretlen"}`);
    });
    ch.on("broadcast", { event: "status" }, ({ payload }) => {
      const p = payload as { status: typeof status; error?: string };
      setStatus(p.status);
      if (p.error) {
        setFailureReason(p.error);
        toast.error(p.error);
      }
    });
    ch.on("broadcast", { event: "cookiesSaved" }, ({ payload }) => {
      const p = payload as { savedCount?: number; platform?: string | null };
      toast.success(
        `Sütik mentve a workflow-hoz (${p.savedCount ?? "?"} db${p.platform ? ` · ${p.platform}` : ""}).`,
        { duration: 3000 },
      );
      setCookieBusy(false);
    });
    ch.on("broadcast", { event: "cookieSaveError" }, ({ payload }) => {
      const p = payload as { error?: string };
      toast.error(`Süti mentés sikertelen: ${p.error ?? "ismeretlen hiba"}`, { duration: 5000 });
      setCookieBusy(false);
    });

    ch.subscribe();
    channelRef.current = ch;
    return () => {
      if (secretTimeoutRef.current !== null) {
        window.clearTimeout(secretTimeoutRef.current);
        secretTimeoutRef.current = null;
      }
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
          const row = msg.new as { status?: typeof status; error?: string | null };
          if (row.status) setStatus(row.status);
          if (row.error) setFailureReason(row.error);
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
    setWorkerTimeout(false);
    setCurrentUrl("");
    setUrlDraft("");
    setActions([]);
    setPageText("");
    setTextBusy(false);
    setInputStatus("");
    setSecretOpen(false);
    setSecretValue("");
    setSecretBusy(false);
    setGmailConfirmBusy(false);
    setKyloUnlockBusy(false);
    setFailureReason("");
    setLockedFrameSize(null);
    clearClickInFlight();
  }, [open, sessionId]);

  useEffect(() => {
    if (!open || !sessionId || status !== "requested" || frame) return;
    const timer = window.setTimeout(() => setWorkerTimeout(true), 8000);
    return () => window.clearTimeout(timer);
  }, [open, sessionId, status, frame]);

  // Vágólap → worker: nem navigator.clipboard.readText()-tel olvasunk, mert
  // iframe / preview környezetben ezt a böngésző gyakran tiltja. A valódi
  // paste esemény clipboardData-ja viszont engedély nélkül elérhető.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      sendToWorker("type", { text });
    };
    window.addEventListener("paste", onPaste, { capture: true });
    return () => window.removeEventListener("paste", onPaste, { capture: true });
  }, [open, sendToWorker]);

  // ESC ne zárja be véletlenül — csak az X gomb
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+V / Cmd+V: hagyjuk, hogy a böngésző valódi paste eseményt adjon.
      // A paste listener kezeli a távoli böngészőbe küldést, az URL-sorban
      // pedig így normálisan működik a beillesztés.
      // Ctrl+A / Cmd+A: MINDIG fogjuk el, akkor is, ha input/textarea van fókuszban,
      // hogy a worker oldali oldalt jelölje ki és küldje vissza a teljes szöveget.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // eslint-disable-next-line no-console
        console.log("[recorder] Ctrl+A elkapva, selectAll küldése a workernek");
        e.preventDefault();
        e.stopPropagation();
        requestSelectAllAndText();
        return;
      }
      // Ha a session még "requested" (worker sosem jelentkezett), engedjük az ESC-et:
      // így nem ragadunk be egy fekete ablakba, amikor pl. a VPS le van állítva.
      if (e.key === "Escape") {
        if (statusRef.current === "requested") {
          e.preventDefault();
          void handleCancel();
          return;
        }
        e.preventDefault();
      }
      if (isEditableTarget(e.target)) return;
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

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
    } catch {
      toast.error("A teljes képernyő nem indítható ebben a böngészőben.");
    }
  }

  // Külön egyszer használatos beillesztési parancs: a worker a kijelölt távoli
  // mezőbe insertText-tel teszi be. Csak a worker visszaigazolása után törlünk.
  async function submitSecret() {
    const text = secretValue;
    if (!text || secretBusy) return;
    setSecretBusy(true);
    setInputStatus("Jelszó beillesztése folyamatban…");
    if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
    secretTimeoutRef.current = window.setTimeout(() => {
      secretTimeoutRef.current = null;
      setSecretBusy(false);
      setInputStatus("A worker nem válaszolt 25 másodpercen belül. A jelszó megmaradt, újra próbálhatod.");
      toast.error("A beillesztés nem fejeződött be. Próbáld újra a mezőre kattintás után.");
    }, 25000);
    const sent = sendToWorker("pasteSecret", { text });
    if (!sent) {
      if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
      secretTimeoutRef.current = null;
      setSecretBusy(false);
      toast.error("Nincs élő kapcsolat a böngészővel.");
      return;
    }
    try {
      const result = await sent;
      if (result !== "ok") {
        if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
        secretTimeoutRef.current = null;
        setSecretBusy(false);
        setInputStatus(`A jelszó küldése sikertelen: ${result}`);
        toast.error("A jelszó nem jutott el a workerhez. Próbáld újra.");
      }
    } catch {
      if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
      secretTimeoutRef.current = null;
      setSecretBusy(false);
      toast.error("A jelszó nem jutott el a workerhez. Próbáld újra.");
    }
  }


  function requestPageText() {
    setTextBusy(true);
    setTextPanelOpen(true);
    sendToWorker("extractText", {});
    window.setTimeout(() => setTextBusy(false), 5000);
  }

  function requestSelectAllAndText() {
    setTextBusy(true);
    setTextPanelOpen(true);
    sendToWorker("selectAll", {});
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

  function selectPanelText() {
    const el = textAreaRef.current;
    if (!el || !pageText) return;
    el.focus();
    el.select();
  }

  function workerKeyFromEvent(e: KeyboardEvent | React.KeyboardEvent) {
    const modifiers: string[] = [];
    if (e.ctrlKey || e.metaKey) modifiers.push("Control");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");
    let key = e.key;
    if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();
    return [...modifiers, key].join("+");
  }

  function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  const handleRemoteKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      e.stopPropagation();
      requestSelectAllAndText();
      return;
    }
    const key = workerKeyFromEvent(e);
    if (!key) return;
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      sendToWorker("key", { key });
    }
  }, [sendToWorker]);

  function handleFrameClick(e: React.MouseEvent<HTMLImageElement>) {
    if (clickInFlightRef.current) {
      setInputStatus("Várj: az előző kattintás még feldolgozás alatt van…");
      return;
    }
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const px = Math.round(x * (frame?.w ?? 0));
    const py = Math.round(y * (frame?.h ?? 0));

    // Ha a kulcsablakban már van jelszó, a következő képkattintás nem külön
    // kattintás lesz: a worker ugyanazon koordinátán megkeresi a mezőt,
    // fókuszálja, majd azonnal beilleszti a jelszót. Így a helyi jelszómező
    // fókusza és a távoli böngésző fókusza nem tudja egymást felülírni.
    if (secretOpen && secretValue && !secretBusy) {
      setSecretBusy(true);
      setInputStatus(`Jelszómező kijelölése és beillesztés… (${px}, ${py})`);
      if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
      secretTimeoutRef.current = window.setTimeout(() => {
        secretTimeoutRef.current = null;
        setSecretBusy(false);
        setInputStatus("A worker nem válaszolt 25 másodpercen belül. A jelszó megmaradt, újra próbálhatod.");
      }, 25000);
      const sent = sendToWorker("pasteSecretAt", {
        text: secretValue,
        x,
        y,
        frameW: frame?.w,
        frameH: frame?.h,
      });
      if (!sent) {
        if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
        secretTimeoutRef.current = null;
        setSecretBusy(false);
        setInputStatus("Nincs aktív kapcsolat a workerhez (channel=null)");
        return;
      }
      void Promise.resolve(sent)
        .then((result) => {
          if (result === "ok") return;
          if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
          secretTimeoutRef.current = null;
          setSecretBusy(false);
          setInputStatus(`A jelszó küldése sikertelen: ${result}`);
        })
        .catch((err) => {
          if (secretTimeoutRef.current !== null) window.clearTimeout(secretTimeoutRef.current);
          secretTimeoutRef.current = null;
          setSecretBusy(false);
          setInputStatus(`Jelszó küldési hiba: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

    clickInFlightRef.current = true;
    if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = window.setTimeout(() => {
      clickInFlightRef.current = false;
      clickTimeoutRef.current = null;
    }, 3500);
    setInputStatus(`Küldés… (${px}, ${py})`);
    const ch = channelRef.current;
    if (!ch) {
      clearClickInFlight();
      setInputStatus("Nincs aktív kapcsolat a workerhez (channel=null)");
      return;
    }
    const sent = ch.send({
      type: "broadcast",
      event: "click",
      payload: { x, y, frameW: frame?.w, frameH: frame?.h },
    });
    void Promise.resolve(sent)
      .then((result) => {
        if (result !== "ok") {
          clearClickInFlight();
          setInputStatus(`Kattintás nem ért el a workerhez: ${String(result)}`);
        } else {
          setInputStatus(`Kattintás elküldve (${px}, ${py}) — várunk a worker visszajelzésére…`);
        }
      })
      .catch((err) => {
        clearClickInFlight();
        setInputStatus(`Kattintás küldési hiba: ${err instanceof Error ? err.message : String(err)}`);
      });
    // A kép csak egy kép — a gépeléshez a rejtett input kell hogy fókuszban legyen.
    window.setTimeout(() => typeInputRef.current?.focus(), 0);
  }

  function handleKyloUnlock() {
    if (kyloUnlockBusy) return;
    setKyloUnlockBusy(true);
    setInputStatus("Kylo logó 7× kattintás indul…");
    const sent = sendToWorker("kyloUnlock", { clicks: 7 });
    if (!sent) {
      setKyloUnlockBusy(false);
      setInputStatus("Nincs aktív kapcsolat a workerhez (channel=null)");
      return;
    }
    void Promise.resolve(sent)
      .then((result) => {
        if (result !== "ok") {
          setKyloUnlockBusy(false);
          setInputStatus(`Kylo 7 kattintás nem ért el a workerhez: ${String(result)}`);
        } else {
          setInputStatus("Kylo logó 7× kattintás elküldve — a worker végrehajtja…");
        }
      })
      .catch((err) => {
        setKyloUnlockBusy(false);
        setInputStatus(`Kylo 7 kattintás küldési hiba: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  async function handleGmailConfirmation() {
    if (!sessionId || gmailConfirmBusy) return;
    setGmailConfirmBusy(true);
    setInputStatus("Gmail megerősítő link keresése…");
    try {
      const found = await callFindGmailConfirmationLink({ data: { sessionId } });
      if (!found.found || !found.link) {
        setInputStatus("Még nem találtam friss megerősítő e-mailt. Várj pár másodpercet és próbáld újra.");
        toast.error("Még nincs friss megerősítő e-mail a csatlakoztatott Gmailben.");
        return;
      }
      const sent = sendToWorker("gmailConfirmLink", {
        url: found.link,
        subject: found.subject,
      });
      if (!sent) {
        setInputStatus("Nincs aktív kapcsolat a workerhez (channel=null)");
        return;
      }
      const result = await Promise.resolve(sent);
      if (result !== "ok") {
        setInputStatus(`Megerősítő link nem ért el a workerhez: ${String(result)}`);
      } else {
        setInputStatus("Megerősítő link megtalálva — megnyitás a worker böngészőben…");
      }
    } catch (err) {
      setInputStatus(`Gmail keresési hiba: ${err instanceof Error ? err.message : String(err)}`);
      toast.error(err instanceof Error ? err.message : "Nem sikerült megkeresni a megerősítő e-mailt.");
    } finally {
      setGmailConfirmBusy(false);
    }
  }


  // Élő gépelés: minden karakter azonnal megy a workernek (nem várunk Enterre).
  // A rejtett input értékét kiürítjük, csak eseményforrásként használjuk.
  function handleType(e: React.KeyboardEvent<HTMLInputElement>) {
    const target = e.target as HTMLInputElement;
    // Speciális billentyűk: preventDefault + key event a workernek
    const specialKeys = new Set([
      "Backspace", "Delete", "Enter", "Tab",
      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
      "Home", "End", "PageUp", "PageDown",
    ]);
    if (specialKeys.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
      const key = workerKeyFromEvent(e);
      if (key) {
        e.preventDefault();
        sendToWorker("key", { key });
      }
      target.value = "";
      return;
    }
    // Nyomtatható egy-karakteres billentyű → azonnal küldjük típusként
    if (e.key.length === 1) {
      e.preventDefault();
      sendToWorker("type", { text: e.key });
      target.value = "";
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
      const normalizedActions = actions.map((action) => {
        if (action.type === "click") {
          return {
            ...action,
            selector:
              typeof action.selector === "string" && action.selector.trim()
                ? action.selector
                : `point:${Math.round((action.x ?? 0) * 10000)},${Math.round((action.y ?? 0) * 10000)}`,
            text: typeof action.text === "string" ? action.text : undefined,
          };
        }
        if (action.type === "type") {
          return {
            ...action,
            selector:
              typeof action.selector === "string" && action.selector.trim()
                ? action.selector
                : "activeElement",
            text: typeof action.text === "string" ? action.text : undefined,
          };
        }
        return action;
      });
      sendToWorker("stop", { save: true });
      await callSave({ data: { sessionId, actions: normalizedActions } });
      toast.success(`Felvétel mentve (${normalizedActions.length} lépés).`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mentés sikertelen");
    } finally {
      setBusy(false);
    }
  }

  function handleSaveCookies() {
    if (!sessionId) return;
    setCookieBusy(true);
    sendToWorker("saveCookies", {});
    // A siker/hiba a channel-en jön vissza (cookiesSaved / cookieSaveError),
    // ami leveszi a cookieBusy-t. Biztonsági timeout 15 mp után.
    setTimeout(() => setCookieBusy(false), 15000);
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

  const isKyloStudyPage = /kylo\.study/i.test(currentUrl || urlDraft);

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
          {isBrowseMode ? "Live Browse" : `${statusLabel} · ${actions.length} lépés`}
        </span>
        {inputStatus && (
          <span className="ml-auto max-w-[50%] truncate rounded bg-white/10 px-2 py-1 text-xs text-emerald-200">
            {inputStatus}
          </span>
        )}

        {isKyloStudyPage && (
          <Button
            size="sm"
            variant="secondary"
            className="bg-sky-700 text-white hover:bg-sky-600"
            onClick={handleKyloUnlock}
            disabled={kyloUnlockBusy || status !== "active"}
            aria-label="Kylo logó hétszeri kattintása"
            title="A Kylo.study rejtett belépőkapujához pontosan 7 logó-kattintást küld"
          >
            {kyloUnlockBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MousePointerClick className="size-4" />
            )}
            <span className="ml-1 hidden lg:inline">Kylo 7×</span>
          </Button>
        )}

        {isKyloStudyPage && (
          <Button
            size="sm"
            variant="secondary"
            className="bg-indigo-700 text-white hover:bg-indigo-600"
            onClick={handleGmailConfirmation}
            disabled={gmailConfirmBusy || status !== "active"}
            aria-label="Gmail megerősítő e-mail megnyitása"
            title="Megkeresi a friss Kylo visszaigazoló e-mailt, és megnyitja a linket a worker böngészőben"
          >
            {gmailConfirmBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MailCheck className="size-4" />
            )}
            <span className="ml-1 hidden xl:inline">E-mail confirm</span>
          </Button>
        )}

        <Button
          size="sm"
          variant="secondary"
          className="bg-amber-700 text-white hover:bg-amber-600"
          onClick={() => setSecretOpen((v) => !v)}
          disabled={status !== "active"}
          aria-label="Jelszó beírása a távoli böngészőbe"
          title="Jelszó (vagy más hosszú szöveg) beírása a távoli böngésző fókuszált mezőjébe"
        >
          <KeyRound className="size-4" />
          <span className="ml-1 hidden lg:inline">Jelszó</span>
        </Button>


        <Button
          size="sm"
          variant="secondary"
          className="bg-emerald-700 text-white hover:bg-emerald-600"
          onClick={handleSaveCookies}
          disabled={cookieBusy || status !== "active"}
          aria-label="Sütik mentése a workflow-ba"
          title="Sütik mentése a workflow-ba (bejelentkezés után)"
        >
          {cookieBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Cookie className="size-4" />
          )}
          <span className="ml-1 hidden md:inline">Sütik mentése</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={handleCancel}
          disabled={busy}
          aria-label={isBrowseMode ? "Live Browse bezárása" : "Felvétel elvetése"}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          <span className="ml-1 hidden md:inline">{isBrowseMode ? "Bezár" : "Elvet"}</span>
        </Button>
        {!isBrowseMode && (
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
        )}
      </div>

      {secretOpen && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-neutral-900 px-3 py-2">
          <KeyRound className="size-4 shrink-0 text-amber-400" />
          <Input
            type="password"
            autoFocus
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSecret();
              }
            }}
            placeholder="Illeszd be ide a jelszót, majd kattints a távoli jelszómezőre"
            className="h-8 flex-1 border-white/20 bg-black/40 text-white placeholder:text-white/40"
          />
          <Button
            size="sm"
            variant="secondary"
            className="bg-amber-700 text-white hover:bg-amber-600"
            onClick={submitSecret}
            disabled={!secretValue || status !== "active" || secretBusy}
          >
            {secretBusy ? <Loader2 className="size-4 animate-spin" /> : "Beillesztés a kijelölt mezőbe"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={() => {
              setSecretValue("");
              setSecretOpen(false);
            }}
          >
            Mégse
          </Button>
        </div>
      )}



      <div className="flex min-h-0 flex-1">
        {/* Böngésző-kép */}
        <div
          ref={imgWrapRef}
          tabIndex={0}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-auto bg-black"
          onKeyDown={handleRemoteKeyDown}
        >
          {frame ? (
            <div
              className="flex shrink-0 items-center justify-center overflow-hidden"
              style={{
                aspectRatio: `${lockedFrameSize?.w ?? frame.w} / ${lockedFrameSize?.h ?? frame.h}`,
                width: zoom === 1 ? "min(100%, calc(100vh * 1.6))" : `${(lockedFrameSize?.w ?? frame.w) * zoom}px`,
                maxWidth: zoom === 1 ? "100%" : "none",
                maxHeight: zoom === 1 ? "100%" : "none",
              }}
            >
              <img
                src={frame.dataUrl}
                alt="Böngésző élő kép"
                className="h-full w-full cursor-crosshair object-fill"
                onClick={handleFrameClick}
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex max-w-md flex-col items-center gap-3 px-4 text-center text-white/70">
              <Camera className="size-10 opacity-50" />
              <div className="text-sm">
                {status === "failed"
                  ? "A Live Browse nem tudott elindulni."
                  : status === "requested"
                  ? "Várjuk, hogy a worker felvegye a felvételt…"
                  : "Még nem érkezett képkocka a workertől."}
              </div>
              {status === "failed" && failureReason && (
                <div className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                  {failureReason}
                </div>
              )}
              {status === "requested" && (
                <div className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {workerTimeout ? (
                    <>
                      A VPS recorder nem vette fel ezt a felvételt. Ellenőrizd a szerveren:
                      <code className="mx-1 rounded bg-white/10 px-1">docker compose logs recorder --tail=80</code>
                    </>
                  ) : (
                    <>
                      Ha a worker (VPS Recorder konténer) nincs elindítva, ez az ablak sosem fog képet mutatni.
                      Nyomj <kbd className="rounded bg-white/10 px-1">Esc</kbd>-et vagy kattints a jobb felső
                      <span className="mx-1 inline-flex items-center rounded bg-white/10 px-1">Elvet</span>
                      gombra a bezáráshoz.
                    </>
                  )}
                </div>
              )}
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
                onClick={selectPanelText}
                disabled={!pageText}
                aria-label="Oldalszöveg kijelölése"
                title="Oldalszöveg kijelölése"
              >
                <ScrollText className="size-4" />
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
              ref={textAreaRef}
              readOnly
              value={textBusy && !pageText ? "Betöltés…" : pageText}
              placeholder="Nincs még beolvasott szöveg."
              className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 text-sm leading-6 text-white outline-none placeholder:text-white/40"
            />
          </aside>
        )}
      </div>

      {/* Alsó sáv: élő gépelést rögzítő input (fókuszba kerül képre kattintáskor) */}
      <div className="flex items-center gap-2 border-t border-white/10 bg-zinc-950 px-3 py-2">
        <span className="text-xs text-white/50">Gépelés:</span>
        <input
          ref={typeInputRef}
          type="text"
          onKeyDown={handleType}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            e.preventDefault();
            e.stopPropagation();
            if (text) sendToWorker("type", { text });
            (e.target as HTMLInputElement).value = "";
          }}
          placeholder="Kattints a képen a mezőbe, aztán gépelj vagy Ctrl+V-vel illessz be"
          className="flex-1 bg-zinc-900 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <span className="text-xs text-white/40">
          {inputStatus || "Tipp: a képen a mezőre kattintasz, majd gépelsz — Enter is átmegy."}
        </span>
      </div>
    </div>
  );
}
