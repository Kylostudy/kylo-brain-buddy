import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Lock, Cookie, ShieldCheck, Globe, Eye, EyeOff, Trash2, LockKeyhole, Pencil, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  getCredentialsStatus,
  saveCredentials,
  deleteCredentials,
} from "@/lib/credentials.functions";
import { previewTotp } from "@/lib/totp.functions";
import { listProxies } from "@/lib/proxies.functions";
import {
  getGmailStatus,
  startGmailOAuth,
  disconnectGmail,
} from "@/lib/gmail.functions";
import { Mail } from "lucide-react";

const PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
  "x",
  "pinterest",
  "linkedin",
  "reddit",
  "threads",
] as const;

export function CredentialsForm({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callStatus = useServerFn(getCredentialsStatus);
  const callSave = useServerFn(saveCredentials);
  const callDelete = useServerFn(deleteCredentials);

  const { data: status } = useQuery({
    queryKey: ["credentials", workflowId],
    queryFn: () => callStatus({ data: { workflowId } }),
  });

  // A workflow spec-jéből deriváljuk a default platformot (pl. LinkedIn workflow → linkedin),
  // hogy új workflow-nál ne "tiktok" jelenjen meg alapból.
  const { data: wf } = useQuery({
    queryKey: ["workflow-platform", workflowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflows")
        .select("spec, name")
        .eq("id", workflowId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const specPlatform = (() => {
    const p = (wf?.spec as { platform?: string } | null)?.platform;
    if (p && (PLATFORMS as readonly string[]).includes(p.toLowerCase())) return p.toLowerCase();
    const nameLower = (wf?.name ?? "").toLowerCase();
    return (PLATFORMS as readonly string[]).find((p) => nameLower.includes(p)) ?? "";
  })();

  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cookie, setCookie] = useState("");
  const [totp, setTotp] = useState("");
  const [proxyId, setProxyId] = useState<string | "">("");
  const [proxyLocked, setProxyLocked] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const callListProxies = useServerFn(listProxies);
  const { data: proxies } = useQuery({
    queryKey: ["proxies-for-credentials"],
    queryFn: () => callListProxies({ data: undefined as never }),
  });

  // Workflow váltáskor minden mezőt üríts — új workflow = üres form.
  useEffect(() => {
    setOpen(false);
    setPlatform("");
    setUsername("");
    setPassword("");
    setCookie("");
    setTotp("");
    setProxyId("");
    setProxyLocked(true);
    setShowPwd(false);
  }, [workflowId]);

  // Ha nincs még kiválasztva platform, használd a spec-ből származót.
  useEffect(() => {
    setPlatform((prev) => prev || specPlatform);
  }, [specPlatform]);


  // Csak akkor töltsd elő a mezőket, ha ehhez a workflow-hoz VAN mentett hozzáférés.
  useEffect(() => {
    if (!status?.exists) return;
    if (status.platform) setPlatform(status.platform);
    if (status.username) setUsername((prev) => prev || status.username!);
    if (status.proxyId) {
      setProxyId(status.proxyId);
      setProxyLocked(true);
    }
  }, [status?.exists, status?.platform, status?.username, status?.proxyId]);

  async function handleSave() {
    // Csak-proxy mentés: ha nincs platform / username / jelszó / cookie, de proxy be van állítva → OK.
    const onlyProxy =
      !platform && !username.trim() && !password && !cookie && proxyId;

    if (!onlyProxy) {
      // Ha bármelyik fiókmező ki van töltve, kérjük be a teljes minimumot.
      if (!platform) {
        toast.error("Válassz platformot (vagy hagyj mindent üresen és csak proxyt ments).");
        return;
      }
      if (!username.trim()) {
        toast.error("Felhasználónév kötelező (vagy hagyj mindent üresen és csak proxyt ments).");
        return;
      }
      if (!password && !cookie && !status?.hasPassword && !status?.hasCookie) {
        toast.error("Adj meg jelszót vagy mentett cookie-t.");
        return;
      }
    }
    setSaving(true);
    try {
      await callSave({
        data: {
          workflowId,
          platform: platform || undefined,
          username: username.trim() || undefined,
          password: password || undefined,
          cookie: cookie || undefined,
          totpSecret: totp || undefined,
          proxyId: proxyId ? proxyId : proxyId === "" && status?.proxyId ? null : undefined,
        },
      });
      toast.success(
        onlyProxy ? "Proxy titkosítva mentve." : "Hozzáférés titkosítva mentve.",
      );
      setPassword("");
      setCookie("");
      setTotp("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["credentials", workflowId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mentés sikertelen.");
    } finally {
      setSaving(false);
    }
  }



  async function handleDelete() {
    if (!confirm("Biztosan törlöd a mentett hozzáférést?")) return;
    await callDelete({ data: { workflowId } });
    qc.invalidateQueries({ queryKey: ["credentials", workflowId] });
    toast.success("Hozzáférés törölve.");
  }

  // TOTP előnézet — a mentett secret jelenlegi kódját mutatja, hogy
  // ellenőrizhető legyen, hogy a Google Authenticatorral megegyezik-e.
  const callPreviewTotp = useServerFn(previewTotp);
  const [totpCode, setTotpCode] = useState<string | null>(null);
  const [totpRemaining, setTotpRemaining] = useState<number>(0);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  async function refreshTotp() {
    setTotpLoading(true);
    setTotpError(null);
    try {
      const res = await callPreviewTotp({ data: { workflowId } });
      if (!res.hasTotp) {
        setTotpError("Nincs mentett TOTP secret.");
        setTotpCode(null);
      } else if ("error" in res && res.error) {
        setTotpError(res.error);
        setTotpCode(null);
      } else if ("code" in res && res.code) {
        setTotpCode(res.code);
        setTotpRemaining(res.secondsRemaining ?? 30);
      }
    } catch (e) {
      setTotpError(e instanceof Error ? e.message : "TOTP hiba");
    } finally {
      setTotpLoading(false);
    }
  }

  // Ha van látható kód, minden másodpercben csökkentjük a hátralévő időt;
  // amikor lejár, automatikusan lekérjük az újat.
  useEffect(() => {
    if (totpCode === null) return;
    const t = setInterval(() => {
      setTotpRemaining((s) => {
        if (s <= 1) {
          void refreshTotp();
          return 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpCode]);

  // Workflow váltáskor rejtsük el a kódot (más fiók, más titok).
  useEffect(() => {
    setTotpCode(null);
    setTotpError(null);
  }, [workflowId]);

  const exists = status?.exists ?? false;


  return (
    <div className="border-t px-4 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Fiók & proxy
        </h2>
        {exists && (
          <button
            type="button"
            onClick={handleDelete}
            className="text-[10px] text-muted-foreground hover:text-destructive"
            title="Törlés"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <GmailCard workflowId={workflowId} />



      {exists && !open ? (
        <div className="mt-2 space-y-2 rounded-md border bg-background/40 p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <KeyRound className="size-3.5 text-primary" />
            <span className="font-medium uppercase">{status?.platform}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono">{status?.usernameMasked}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {status?.hasPassword && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                <Lock className="size-3" /> jelszó
              </span>
            )}
            {status?.hasCookie && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                <Cookie className="size-3" /> cookie
              </span>
            )}
            {status?.hasTotp && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                <ShieldCheck className="size-3" /> 2FA
              </span>
            )}
            {(status as { hasProxy?: boolean })?.hasProxy && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                <Globe className="size-3" /> proxy
              </span>
            )}
          </div>
          {status?.hasTotp && (
            <div className="flex items-center gap-2 rounded border bg-background/60 px-2 py-1.5">
              <ShieldCheck className="size-3.5 text-primary shrink-0" />
              {totpCode ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(totpCode);
                      toast.success("TOTP kód a vágólapra másolva.");
                    }}
                    className="font-mono text-sm tracking-widest tabular-nums hover:text-primary inline-flex items-center gap-1"
                    title="Másolás vágólapra"
                  >
                    {totpCode}
                    <Copy className="size-3 opacity-60" />
                  </button>
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {totpRemaining}s
                  </span>
                </>
              ) : totpError ? (
                <span className="text-[11px] text-destructive">{totpError}</span>
              ) : (
                <button
                  type="button"
                  onClick={refreshTotp}
                  disabled={totpLoading}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {totpLoading ? "Lekérés…" : "TOTP kód mutatása (teszt)"}
                </button>
              )}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setOpen(true)}
          >
            Módosítás
          </Button>
        </div>
      ) : !exists && !open ? (
        <div className="mt-2 space-y-2 rounded-md border border-dashed bg-background/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            Még nincs beállítás. Ide vagy egy teljes fiókot (platform + felhasználó + jelszó), vagy <b>csak proxyt</b> menthetsz — mindkettő önállóan is működik. A titkos adatok AES-256-GCM-mel titkosítva tárolódnak.
          </p>
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => setOpen(true)}
          >
            Fiók vagy proxy hozzáadása
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2.5 rounded-md border bg-background/40 p-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Platform</Label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="h-8 w-full rounded border bg-background px-2 text-xs"
            >
              <option value="" disabled>Válassz platformot…</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              Felhasználónév / email
            </Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={status?.usernameMasked ?? "pl. kylohu"}
              className="h-8 text-xs"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              Jelszó {status?.hasPassword && <span className="text-muted-foreground/60">(üres = változatlan)</span>}
            </Label>
            <div className="relative">
              <Input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 pr-8 text-xs"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              Session cookie (opcionális, JSON) {status?.hasCookie && <span className="text-muted-foreground/60">(üres = változatlan)</span>}
            </Label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={2}
              placeholder='[{"name":"sessionid","value":"..."}]'
              className="w-full rounded border bg-background px-2 py-1 font-mono text-[10px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              2FA secret (opcionális) {status?.hasTotp && <span className="text-muted-foreground/60">(üres = változatlan)</span>}
            </Label>
            <Input
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="JBSWY3DPEHPK3PXP"
              className="h-8 font-mono text-[10px]"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">
              Proxy (az előre feltöltött listából)
            </Label>
            {proxyLocked && proxyId ? (
              <div className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1.5">
                <LockKeyhole className="size-3.5 text-primary" />
                <span className="flex-1 truncate text-xs font-medium">
                  {proxies?.find((p) => p.id === proxyId)
                    ? `${proxies.find((p) => p.id === proxyId)!.label}${
                        proxies.find((p) => p.id === proxyId)!.country
                          ? ` (${proxies.find((p) => p.id === proxyId)!.country})`
                          : ""
                      }`
                    : (status?.proxyLabel ?? "kiválasztott proxy")}
                </span>
                <button
                  type="button"
                  onClick={() => setProxyLocked(false)}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  title="Feloldás módosításhoz"
                >
                  <Pencil className="size-3" /> módosít
                </button>
              </div>
            ) : (
              <select
                value={proxyId}
                onChange={(e) => setProxyId(e.target.value)}
                className="h-8 w-full rounded border bg-background px-2 text-xs"
              >
                <option value="">— nincs proxy —</option>
                {(proxies ?? [])
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.country ? ` (${p.country})` : ""}
                      {p.provider ? ` · ${p.provider}` : ""}
                    </option>
                  ))}
              </select>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              Kiválasztás után lezárva marad, hogy véletlenül ne írd át. A „módosít" gombbal oldható fel.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Mentés…" : "Mentés titkosítva"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Mégse
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GmailCard({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callStatus = useServerFn(getGmailStatus);
  const callStart = useServerFn(startGmailOAuth);
  const callDisconnect = useServerFn(disconnectGmail);

  const { data } = useQuery({
    queryKey: ["gmail-status", workflowId],
    queryFn: () => callStatus({ data: { workflowId } }),
  });

  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    const oauthWindow = window.open("about:blank", "_blank", "width=560,height=760");
    try {
      const host = window.location.hostname;
      const previewProjectId = host.endsWith(".lovableproject.com")
        ? host.replace(".lovableproject.com", "")
        : host.match(/^id-preview--([a-f0-9-]+)\.lovable\.app$/)?.[1];
      const callbackOrigin = previewProjectId
        ? `https://project--${previewProjectId}-dev.lovable.app`
        : window.location.origin;
      const redirectUri = `${callbackOrigin}/api/public/auth/google/callback`;
      const { url } = await callStart({ data: { workflowId, redirectUri } });
      if (oauthWindow) {
        oauthWindow.location.href = url;
        window.addEventListener(
          "focus",
          () => qc.invalidateQueries({ queryKey: ["gmail-status", workflowId] }),
          { once: true },
        );
        toast.success("A Google engedélyezés új ablakban nyílt meg.");
        setBusy(false);
        return;
      }
      window.location.href = url;
    } catch (e) {
      if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
      toast.error(e instanceof Error ? e.message : "Nem sikerült elindítani a Google OAuth-ot.");
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Biztos leválasztod a Gmail fiókot erről a workflow-ról?")) return;
    setBusy(true);
    try {
      await callDisconnect({ data: { workflowId } });
      toast.success("Gmail leválasztva.");
      qc.invalidateQueries({ queryKey: ["gmail-status", workflowId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Leválasztás sikertelen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border bg-background/40 p-2.5">
      <div className="flex items-center gap-2">
        <Mail className="size-3.5 text-primary shrink-0" />
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Gmail (2FA / verifikációs kódok)
        </div>
      </div>
      {data?.connected ? (
        <div className="mt-2 space-y-2">
          <div className="text-xs">
            <span className="text-muted-foreground">Csatlakoztatva: </span>
            <span className="font-mono">{data.email}</span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleConnect}
              disabled={busy}
            >
              Újracsatlakoztatás
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDisconnect}
              disabled={busy}
            >
              Leválasztás
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Kösd össze ehhez a workflow-hoz tartozó Gmail címet, hogy a rendszer automatikusan ki tudja olvasni a bejövő verifikációs kódokat.
          </p>
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={handleConnect}
            disabled={busy}
          >
            {busy ? "Átirányítás…" : "Gmail csatlakoztatása"}
          </Button>
        </div>
      )}
    </div>
  );
}
