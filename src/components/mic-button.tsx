import { useRef, useState } from "react";
import { Mic, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  /** Called when transcription completes. If `send` is true, the parent should
   *  submit the text immediately instead of just inserting it into the input. */
  onTranscript: (text: string, opts: { send: boolean }) => void;
  language?: string; // ISO-639-1, e.g. "hu"
  disabled?: boolean;
};

export function MicButton({ onTranscript, language = "hu", disabled }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // What to do once the recorder finishes flushing: send to chat or just paste.
  const intentRef = useRef<"send" | "paste" | "cancel">("paste");

  async function start() {
    if (disabled) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Nincs mikrofon hozzáférés. Engedélyezd a böngészőben.");
      return;
    }
    const mimeType =
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      ) ?? "";
    if (!mimeType) {
      stream.getTracks().forEach((t) => t.stop());
      toast.error("A böngésződ nem támogat felvételt megfelelő formátumban.");
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    streamRef.current = stream;
    intentRef.current = "paste";
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const intent = intentRef.current;
      if (intent === "cancel") {
        chunksRef.current = [];
        setState("idle");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      if (blob.size < 1024) {
        toast.error("Túl rövid felvétel — próbáld újra.");
        setState("idle");
        return;
      }
      setState("uploading");
      try {
        const ext = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
        const form = new FormData();
        form.append("file", blob, `recording.${ext}`);
        if (language) form.append("language", language);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const text = (data.text ?? "").trim();
        if (!text) {
          toast.warning("Nem ismertem fel beszédet a felvételen.");
        } else {
          onTranscript(text, { send: intent === "send" });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Átírás sikertelen.");
      } finally {
        setState("idle");
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    setState("recording");
  }

  function stopWith(intent: "send" | "paste" | "cancel") {
    intentRef.current = intent;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    recorderRef.current = null;
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Felvétel elvetése"
          onClick={() => stopWith("cancel")}
        >
          <X className="size-4" />
        </Button>
        <span className="px-1 text-xs font-medium text-destructive animate-pulse">
          ●
        </span>
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          aria-label="Felvétel kész — küldés"
          onClick={() => stopWith("send")}
        >
          <Check className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={
        state === "uploading" ? "Átírás folyamatban" : "Hangrögzítés indítása"
      }
      onClick={() => state === "idle" && start()}
      disabled={disabled || state === "uploading"}
    >
      {state === "uploading" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
