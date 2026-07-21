import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Play, CheckCircle2, Plus, BookOpen, Flame } from "lucide-react";

import {
  listRedditWarmupAccounts,
  upsertRedditWarmupAccount,
  startRedditWarmup,
  markRedditWarmupReady,
  listRedditWarmupLog,
  logRedditWarmupDay,
  listRedditStories,
  upsertRedditStory,
  deleteRedditStory,
  listProxiesForWarmup,
  listBrainWorkflowsForWarmup,
} from "@/lib/reddit-warmup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const LANGUAGES = [
  { code: "en-US", label: "Angol · US" },
  { code: "en-GB", label: "Angol · UK" },
  { code: "en-CA", label: "Angol · Kanada" },
  { code: "en-AU", label: "Angol · Ausztrália" },
  { code: "en-NL", label: "Angol · NL" },
  { code: "fr-FR", label: "Francia" },
  { code: "de-DE", label: "Német · DE" },
  { code: "de-AT", label: "Német · AT" },
  { code: "de-CH", label: "Német · CH" },
  { code: "es-ES", label: "Spanyol · ES" },
  { code: "es-MX", label: "Spanyol · MX" },
  { code: "pt-PT", label: "Portugál · PT" },
  { code: "pt-BR", label: "Portugál · BR" },
  { code: "ru-RU", label: "Orosz" },
  { code: "pl-PL", label: "Lengyel" },
  { code: "ja-JP", label: "Japán" },
  { code: "zh-CN", label: "Kínai" },
  { code: "ko-KR", label: "Koreai" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ar-SA", label: "Arab" },
];

export const Route = createFileRoute("/_authenticated/reddit-warmup")({
  component: RedditWarmupPage,
  head: () => ({
    meta: [
      { title: "Reddit Warmup — Kylo Brain" },
      { name: "description", content: "Reddit fiókok warmup követése, napi napló, story bank a 11 nyelvi változathoz." },
      { property: "og:title", content: "Reddit Warmup — Kylo Brain" },
      { property: "og:description", content: "Reddit fiókok fokozatos warmup követése és founder story bank." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function RedditWarmupPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Flame className="size-5 text-orange-500" />
        <h1 className="text-2xl font-semibold">Reddit Warmup</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">
        A rendszer célja: minden Reddit fiókot 7 napon át finoman „bemelegíteni" görgetéssel, upvote-okkal és 3–4 subreddithez való csatlakozással,
        mielőtt bármit posztolnánk. A napi aktivitást manuálisan (Live Browse) csináljuk, itt csak naplózzuk. Amint egy fiók „érett", jelöld készre.
      </p>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Fiókok</TabsTrigger>
          <TabsTrigger value="stories">Story Bank</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="pt-4">
          <AccountsPanel />
        </TabsContent>
        <TabsContent value="stories" className="pt-4">
          <StoriesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------- ACCOUNTS -------------------
function AccountsPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listRedditWarmupAccounts);
  const proxies = useServerFn(listProxiesForWarmup);
  const workflows = useServerFn(listBrainWorkflowsForWarmup);
  const startFn = useServerFn(startRedditWarmup);
  const readyFn = useServerFn(markRedditWarmupReady);

  const accountsQ = useQuery({ queryKey: ["warmup-accounts"], queryFn: () => list() });
  const proxiesQ = useQuery({ queryKey: ["warmup-proxies"], queryFn: () => proxies() });
  const workflowsQ = useQuery({ queryKey: ["warmup-workflows"], queryFn: () => workflows() });

  const startM = useMutation({
    mutationFn: (id: string) => startFn({ data: { account_id: id } }),
    onSuccess: () => { toast.success("Warmup elindítva"); qc.invalidateQueries({ queryKey: ["warmup-accounts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const readyM = useMutation({
    mutationFn: (id: string) => readyFn({ data: { account_id: id } }),
    onSuccess: () => { toast.success("Fiók készre jelölve"); qc.invalidateQueries({ queryKey: ["warmup-accounts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const proxiesMap = new Map((proxiesQ.data ?? []).map((p: any) => [p.id, p]));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AccountDialog proxies={proxiesQ.data ?? []} workflows={workflowsQ.data ?? []} />
      </div>
      <div className="grid gap-3">
        {accountsQ.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Még nincs fiók. Adj hozzá egyet a fenti gombbal.</p>
        )}
        {accountsQ.data?.map((a: any) => {
          const proxy = a.proxy_id ? proxiesMap.get(a.proxy_id) : null;
          const days = a.warmup_days_completed ?? 0;
          const target = 7;
          return (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{a.username || "(nincs username)"}</span>
                  <Badge variant="outline">{a.language ?? a.locale}</Badge>
                  {proxy && <Badge variant="secondary">{proxy.country} · {proxy.label}</Badge>}
                  <StatusBadge status={a.warmup_status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${Math.min(100, (days / target) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-14 text-right">{days} / {target} nap</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {a.warmup_status === "not_started" && (
                    <Button size="sm" onClick={() => startM.mutate(a.id)}>
                      <Play className="size-3.5 mr-1" /> Warmup indítása
                    </Button>
                  )}
                  {a.warmup_status === "in_progress" && (
                    <>
                      <LogDayDialog accountId={a.id} />
                      {days >= target && (
                        <Button size="sm" variant="default" onClick={() => readyM.mutate(a.id)}>
                          <CheckCircle2 className="size-3.5 mr-1" /> Készre jelölés
                        </Button>
                      )}
                    </>
                  )}
                  {a.warmup_status === "ready" && (
                    <Badge className="bg-green-600">Készen áll a posztolásra</Badge>
                  )}
                  <ViewLogDialog accountId={a.id} />
                </div>
                {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") return <Badge className="bg-green-600">Kész</Badge>;
  if (status === "in_progress") return <Badge className="bg-orange-500">Folyamatban</Badge>;
  return <Badge variant="outline">Nem indult</Badge>;
}

function AccountDialog({ proxies, workflows }: { proxies: any[]; workflows: any[] }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertRedditWarmupAccount);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [proxyId, setProxyId] = useState<string>("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [subs, setSubs] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: () => upsert({
      data: {
        username: username || null,
        language,
        locale: language,
        proxy_id: proxyId || null,
        workflow_id: workflowId,
        target_subreddits: subs.split(",").map(s => s.trim()).filter(Boolean),
        notes: notes || null,
      },
    }),
    onSuccess: () => {
      toast.success("Fiók létrehozva");
      qc.invalidateQueries({ queryKey: ["warmup-accounts"] });
      setOpen(false);
      setUsername(""); setSubs(""); setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4 mr-1" /> Új fiók</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Új Reddit fiók warmup-hoz</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Reddit username</Label><Input value={username} onChange={e => setUsername(e.target.value)} placeholder="u/valami" /></div>
          <div>
            <Label>Nyelv / lokalizáció</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Proxy</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger><SelectValue placeholder="válassz proxyt" /></SelectTrigger>
              <SelectContent>
                {proxies.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.country} · {p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kapcsolódó workflow</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger><SelectValue placeholder="válassz workflow-t" /></SelectTrigger>
              <SelectContent>
                {workflows.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name} ({w.platform})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Célsubredditek (vesszővel)</Label><Input value={subs} onChange={e => setSubs(e.target.value)} placeholder="r/EnglishLearning, r/IELTS" /></div>
          <div><Label>Megjegyzések</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!workflowId || m.isPending}>Létrehozás</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogDayDialog({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const logFn = useServerFn(logRedditWarmupDay);
  const [open, setOpen] = useState(false);
  const [scroll, setScroll] = useState(20);
  const [ups, setUps] = useState(5);
  const [coms, setComs] = useState(0);
  const [subs, setSubs] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: () => logFn({
      data: {
        account_id: accountId,
        scroll_minutes: scroll,
        upvotes: ups,
        comments: coms,
        joined_subreddits: subs.split(",").map(s => s.trim()).filter(Boolean),
        notes: notes || null,
      },
    }),
    onSuccess: () => {
      toast.success("Napi warmup naplózva");
      qc.invalidateQueries({ queryKey: ["warmup-accounts"] });
      qc.invalidateQueries({ queryKey: ["warmup-log", accountId] });
      setOpen(false);
      setSubs(""); setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">+ Mai nap</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Mai warmup napló</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Görgetés (perc)</Label><Input type="number" value={scroll} onChange={e => setScroll(+e.target.value)} /></div>
          <div><Label>Upvote</Label><Input type="number" value={ups} onChange={e => setUps(+e.target.value)} /></div>
          <div><Label>Komment</Label><Input type="number" value={coms} onChange={e => setComs(+e.target.value)} /></div>
        </div>
        <div><Label>Ma csatlakozott subredditek</Label><Input value={subs} onChange={e => setSubs(e.target.value)} placeholder="r/IELTS, r/languagelearning" /></div>
        <div><Label>Megjegyzés</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={m.isPending}>Mentés</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewLogDialog({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const logFn = useServerFn(listRedditWarmupLog);
  const logQ = useQuery({ queryKey: ["warmup-log", accountId], queryFn: () => logFn({ data: { account_id: accountId } }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Napló</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Warmup napló</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {logQ.data?.length === 0 && <p className="text-sm text-muted-foreground">Még nincs bejegyzés.</p>}
          {logQ.data?.map((l: any) => (
            <div key={l.id} className="border rounded p-2 text-sm">
              <div className="flex gap-3 items-center">
                <span className="font-medium">{l.activity_date}</span>
                <Badge variant="outline">{l.scroll_minutes} perc</Badge>
                <Badge variant="outline">{l.upvotes} up</Badge>
                <Badge variant="outline">{l.comments} komment</Badge>
              </div>
              {Array.isArray(l.joined_subreddits) && l.joined_subreddits.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1">Sub-ok: {l.joined_subreddits.join(", ")}</div>
              )}
              {l.notes && <p className="text-xs mt-1">{l.notes}</p>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------- STORIES -------------------
function StoriesPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listRedditStories);
  const del = useServerFn(deleteRedditStory);
  const storiesQ = useQuery({ queryKey: ["stories"], queryFn: () => list() });

  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["stories"] }); },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><StoryDialog /></div>
      <div className="grid gap-3">
        {storiesQ.data?.length === 0 && <p className="text-sm text-muted-foreground">Még nincs story. Add hozzá a 11 nyelvi változatot.</p>}
        {storiesQ.data?.map((s: any) => (
          <Card key={s.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4" />
                <Badge variant="outline">{s.language}</Badge>
                <span>{s.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{s.body}</p>
              <div className="flex gap-2 mt-2">
                <StoryDialog story={s} />
                <Button size="sm" variant="ghost" onClick={() => delM.mutate(s.id)}>Törlés</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StoryDialog({ story }: { story?: any }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertRedditStory);
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState(story?.language ?? "en-US");
  const [title, setTitle] = useState(story?.title ?? "");
  const [body, setBody] = useState(story?.body ?? "");
  const [notes, setNotes] = useState(story?.notes ?? "");

  const m = useMutation({
    mutationFn: () => upsert({ data: { id: story?.id, language, title, body, notes: notes || null } }),
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["stories"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={story ? "outline" : "default"}>
          {story ? "Szerkesztés" : <><Plus className="size-4 mr-1" /> Új story</>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{story ? "Story szerkesztése" : "Új founder story"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nyelv</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Cím</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Szöveg</Label><Textarea value={body} onChange={e => setBody(e.target.value)} rows={12} /></div>
          <div><Label>Megjegyzés</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!title || !body || m.isPending}>Mentés</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
