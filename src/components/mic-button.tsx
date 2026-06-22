import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  onTranscript: (text: string) => void;
  language?: string; // ISO-639-1, e.g. "hu"
  disabled?: boolean;
};

export function MicButton({ onTranscript, language = "hu", disabled }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

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
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
          onTranscript(text);
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

  function stop() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    recorderRef.current = null;
  }

  const onClick = () => {
    if (state === "idle") start();
    else if (state === "recording") stop();
  };

  return (
    <Button
      type="button"
      variant={state === "recording" ? "destructive" : "ghost"}
      size="icon-sm"
      aria-label={
        state === "recording"
          ? "Felvétel leállítása"
          : state === "uploading"
            ? "Átírás folyamatban"
            : "Hangrögzítés indítása"
      }
      onClick={onClick}
      disabled={disabled || state === "uploading"}
    >
      {state === "uploading" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === "recording" ? (
        <Square className="size-4" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
