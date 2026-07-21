// Kétirányú fordító panel: magyarul begépeled, célnyelvre lefordítja,
// és automatikusan visszafordítja magyarra, hogy lásd, mit fog valójában
// publikálni a Rendszer a te nevedben. Semmi automatikus posztolás.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Wand2, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { translateHuToTarget } from "@/lib/translation.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Props {
  targetLang: string; // pl. "en-GB", "ja", "ar"
  subreddit?: string;
  contextTitle?: string;
  replyingTo?: string;
  initialHu?: string;
  initialTranslated?: string;
  className?: string;
}

export function TranslationEditor({
  targetLang,
  subreddit,
  contextTitle,
  replyingTo,
  initialHu = "",
  initialTranslated = "",
  className,
}: Props) {
  const callTranslate = useServerFn(translateHuToTarget);
  const [hu, setHu] = useState(initialHu);
  const [translated, setTranslated] = useState(initialTranslated);
  const [reverseHu, setReverseHu] = useState("");
  const [targetName, setTargetName] = useState<string>(targetLang);
  const [loading, setLoading] = useState(false);

  async function runTranslate() {
    if (!hu.trim()) return;
    setLoading(true);
    try {
      const r = await callTranslate({
        data: {
          hungarian: hu,
          targetLang,
          subreddit,
          contextTitle,
          replyingTo,
        },
      });
      setTranslated(r.translated);
      setReverseHu(r.reverseHu);
      setTargetName(r.targetName);
      if (!r.translated) toast.error("A fordítás nem sikerült.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fordítási hiba.");
    } finally {
      setLoading(false);
    }
  }

  async function copyTranslated() {
    if (!translated.trim()) return;
    await navigator.clipboard.writeText(translated);
    toast.success(`${targetName} válasz vágólapon.`);
  }

  return (
    <div className={`space-y-3 rounded-md border bg-muted/20 p-3 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">HU → {targetName}</Badge>
        <span className="text-[10px] text-muted-foreground">
          Írd magyarul, a rendszer natívan lefordítja és visszaellenőrzi.
        </span>
      </div>

      <div>
        <Label className="text-xs">1. Magyarul (amit mondani szeretnél)</Label>
        <Textarea
          value={hu}
          onChange={(e) => setHu(e.target.value)}
          rows={4}
          placeholder="Írd le magyarul, mit válaszolnál…"
          className="text-sm"
        />
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={runTranslate} disabled={loading || !hu.trim()}>
            {loading ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Wand2 className="mr-1 size-3.5" />}
            Fordítás + vissza-ellenőrzés
          </Button>
          {(translated || reverseHu) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTranslated("");
                setReverseHu("");
              }}
            >
              <RotateCcw className="mr-1 size-3.5" /> Ürítés
            </Button>
          )}
        </div>
      </div>

      {translated && (
        <div>
          <Label className="text-xs">2. {targetName} változat (szerkeszthető, ez megy Redditre)</Label>
          <Textarea
            value={translated}
            onChange={(e) => setTranslated(e.target.value)}
            rows={4}
            className="font-mono text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={copyTranslated} disabled={!translated.trim()}>
              <Copy className="mr-1 size-3.5" /> Másolás
            </Button>
          </div>
        </div>
      )}

      {reverseHu && (
        <div>
          <Label className="text-xs">3. Vissza-ellenőrzés — így fog hangzani magyarul</Label>
          <div className="rounded-md border border-dashed bg-background p-2 text-sm whitespace-pre-wrap">
            {reverseHu}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Ha nem ezt akarod mondani, írd át a magyar szöveget és fordíts újra.
          </p>
        </div>
      )}
    </div>
  );
}
