import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Paperclip, Send, Trash2, Trophy, Upload, X } from "lucide-react";

import {
  listContentDrafts,
  saveContentDraft,
  deleteContentDraft,
  queueContentDraft,
  recommendMatureRedditAccount,
} from "@/lib/content-drafts.functions";
import { createMediaUploadUrl, MEDIA_SLOTS } from "@/lib/content-media.functions";
import { supabase } from "@/integrations/supabase/client";
import { listBrainWorkflowsForWarmup } from "@/lib/reddit-warmup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const KINDS = [
  { value: "reddit_post", label: "Reddit poszt" },
  { value: "reddit_comment", label: "Reddit hozzászólás" },
  { value: "linkedin_post", label: "LinkedIn poszt" },
  { value: "generic_text", label: "Egyéb szöveg" },
];


export const Route = createFileRoute("/_authenticated/content")({
  component: ContentStudioPage,
  head: () => ({
    meta: [
      { title: "Tartalom Stúdió — Kylo Brain" },
      {
        name: "description",
        content:
          "Illeszd be a poszt szövegét, válaszd ki a cél-workflow-t, és a worker emberi tempóban begépeli.",
      },
      { property: "og:title", content: "Tartalom Stúdió — Kylo Brain" },
      {
        property: "og:description",
        content: "Beillesztett szöveg kiküldése bármelyik Brain workflow-nak, emberi gépeléssel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ContentStudioPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listContentDrafts);
  const saveFn = useServerFn(saveContentDraft);
  const delFn = useServerFn(deleteContentDraft);
  const queueFn = useServerFn(queueContentDraft);
  const wfFn = useServerFn(listBrainWorkflowsForWarmup);
  const recFn = useServerFn(recommendMatureRedditAccount);

  const draftsQ = useQuery({
    queryKey: ["content-drafts"],
    queryFn: () => listFn(),
    refetchInterval: 15000,
  });
  const wfQ = useQuery({ queryKey: ["content-workflows"], queryFn: () => wfFn() });
  const recQ = useQuery({ queryKey: ["mature-reddit"], queryFn: () => recFn() });

  const [kind, setKind] = useState("reddit_post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [targetRef, setTargetRef] = useState("");

  // Fájlfeltöltés állapota
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mediaSlot, setMediaSlot] = useState<string>("linkedin_profile_photo");
  const [uploading, setUploading] = useState(false);
  const uploadUrlFn = useServerFn(createMediaUploadUrl);

  // Ha még nincs kiválasztott workflow, a legérettebb fiókét ajánljuk fel.
  useEffect(() => {
    const best = recQ.data?.best;
    if (!workflowId && best?.workflow_id) setWorkflowId(best.workflow_id);
  }, [recQ.data, workflowId]);

  async function uploadIfNeeded() {
    if (!file) return null;
    setUploading(true);
    try {
      const target = await uploadUrlFn({ data: { file_name: file.name } });
      const { error } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file);
      if (error) throw new Error(error.message);
      return {
        media_path: target.path,
        media_name: file.name,
        media_mime: file.type || null,
        media_size: file.size,
        media_slot: mediaSlot,
      };
    } finally {
      setUploading(false);
    }
  }

  const saveM = useMutation({
    mutationFn: async () => {
      const media = await uploadIfNeeded();
      return saveFn({
        data: {
          kind,
          title,
          body,
          target_workflow_id: workflowId || null,
          target_ref: targetRef || null,
          ...(media ?? {}),
        },
      });
    },
    onSuccess: () => {
      toast.success(file ? "Mentve a fájllal együtt." : "Szöveg elmentve.");
      setTitle("");
      setBody("");
      setTargetRef("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const queueM = useMutation({
    mutationFn: (v: { id: string; dry_run: boolean }) =>
      queueFn({ data: { id: v.id, dry_run: v.dry_run } }),
    onSuccess: () => {
      toast.success("Sorba állítva — a worker begépeli.");
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Törölve.");
      qc.invalidateQueries({ queryKey: ["content-drafts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const workflows = wfQ.data ?? [];
  const best = recQ.data?.best;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardPaste className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold">Tartalom Stúdió</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">
        Illeszd be ide a szöveget (Ctrl+V a saját gépeden), válaszd ki, melyik workflow
        vigye ki, és a worker emberi tempóban begépeli a távoli böngészőben — nem
        vágólapról másol, tehát életszerű marad.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-amber-500" /> Ma esti ajánlás — legérettebb Reddit fiók
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recQ.isLoading && <p className="text-sm text-muted-foreground">Számolás…</p>}
          {best && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{best.username ?? "névtelen"}</Badge>
              <Badge variant="outline">{best.locale ?? best.language}</Badge>
              <span className="text-muted-foreground">
                {best.days} nap · {best.minutes} perc · {best.upvotes} upvote · pontszám{" "}
                <b>{best.score}</b>
              </span>
              <Badge variant={best.ready ? "default" : "secondary"}>
                {best.ready ? "érett" : "még melegszik"}
              </Badge>
            </div>
          )}
          <div className="space-y-1 pt-2">
            {(recQ.data?.ranked ?? []).slice(1, 6).map((r) => (
              <div key={r.account_id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-40 truncate">{r.username ?? "névtelen"}</span>
                <span>{r.locale ?? r.language}</span>
                <span>{r.days} nap</span>
                <span>{r.upvotes} upvote</span>
                <span>pont: {r.score}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Új szöveg</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Típus</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cél workflow</Label>
              <Select value={workflowId} onValueChange={setWorkflowId}>
                <SelectTrigger><SelectValue placeholder="Válassz workflow-t" /></SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.platform ? ` · ${w.platform}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{kind === "linkedin_post" ? "Céges oldal (üresen: személyes profil)" : "Hely (pl. subreddit)"}</Label>
              <Input
                value={targetRef}
                onChange={(e) => setTargetRef(e.target.value)}
                placeholder={kind === "linkedin_post" ? "127334023 vagy kylo-study" : "r/EnglishLearning"}
              />
            </div>

          </div>
          <div className="space-y-1">
            <Label>Cím</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A poszt címe" />
          </div>
          <div className="space-y-1">
            <Label>Szöveg</Label>
            <Textarea
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ide illeszd be a poszt szövegét…"
            />
            <p className="text-xs text-muted-foreground">{body.length} karakter</p>
          </div>

          <div className="rounded-md border border-dashed p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Paperclip className="size-4 text-primary" /> Fájl feltöltése (kép / videó)
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Fájl</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={file ? file.name : ""}
                    placeholder="Nincs fájl kiválasztva"
                    onClick={() => fileRef.current?.click()}
                  />
                  <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-2 size-4" /> Tallózás
                  </Button>
                  {file && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "ismeretlen típus"}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Hova kerüljön?</Label>
                <Select value={mediaSlot} onValueChange={setMediaSlot}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEDIA_SLOTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A fenti „Cél workflow” dönti el, melyik fiók böngészője viszi ki.
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={() => saveM.mutate()}
            disabled={(!body.trim() && !file) || saveM.isPending || uploading}
          >
            {uploading ? "Fájl feltöltése…" : saveM.isPending ? "Mentés…" : "Mentés"}
          </Button>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mentett szövegek</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(draftsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Még nincs mentett szöveg.</p>
          )}
          {(draftsQ.data ?? []).map((d) => (
            <div key={d.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{d.title || "(cím nélkül)"}</span>
                <Badge variant="outline">{d.kind}</Badge>
                {d.target_ref && <Badge variant="secondary">{d.target_ref}</Badge>}
                <Badge
                  variant={
                    d.status === "failed"
                      ? "destructive"
                      : d.status === "posted"
                        ? "default"
                        : "secondary"
                  }
                >
                  {d.status === "posted"
                    ? "kiment"
                    : d.status === "running"
                      ? "fut"
                      : d.status === "queued"
                        ? "sorban áll"
                        : d.status === "failed"
                          ? "hibázott"
                          : d.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {workflows.find((w) => w.id === d.target_workflow_id)?.name ?? "nincs workflow"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{d.body}</p>
              {(() => {
                // Csak AZ A SOR legyen letiltva, amelyiken épp művelet fut —
                // a többi vázlat gombjai maradjanak használhatók.
                const queueBusy = queueM.isPending && queueM.variables?.id === d.id;
                const delBusy = delM.isPending && delM.variables === d.id;
                const rowBusy = queueBusy || delBusy;
                const dryBusy = queueBusy && queueM.variables?.dry_run === true;
                const sendBusy = queueBusy && queueM.variables?.dry_run === false;
                return (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => queueM.mutate({ id: d.id, dry_run: true })}
                      disabled={rowBusy}
                    >
                      {dryBusy ? "Indítás…" : "Próba (begépel, nem küldi el)"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => queueM.mutate({ id: d.id, dry_run: false })}
                      disabled={rowBusy}
                    >
                      <Send className="mr-2 size-4" />
                      {sendBusy ? "Kiküldés…" : "Kiküldés a workflow-nak"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => delM.mutate(d.id)}
                      disabled={rowBusy}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })()}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
