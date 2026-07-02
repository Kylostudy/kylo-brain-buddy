import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Globe, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

import {
  listProxies,
  createProxy,
  updateProxy,
  deleteProxy,
} from "@/lib/proxies.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/proxies")({
  head: () => ({
    meta: [
      { title: "Proxyk — Kylo Brain" },
      {
        name: "description",
        content:
          "Titkosított proxy tár. SOC2-kompatibilis AES-256-GCM titkosítás a felhasználónévre és jelszóra.",
      },
    ],
  }),
  component: ProxiesPage,
});

type ProxyRow = Awaited<ReturnType<typeof listProxies>>[number];

type FormState = {
  id?: string;
  label: string;
  country: string;
  provider: string;
  kind: "isp" | "residential" | "datacenter" | "mobile";
  protocol: "http" | "socks5";
  host: string;
  port: number;
  username: string;
  password: string;
  notes: string;
  is_active: boolean;
  clearPassword?: boolean;
};

function emptyForm(): FormState {
  return {
    label: "",
    country: "",
    provider: "",
    kind: "isp",
    protocol: "http",
    host: "",
    port: 8080,
    username: "",
    password: "",
    notes: "",
    is_active: true,
  };
}

function ProxiesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProxies);
  const createFn = useServerFn(createProxy);
  const updateFn = useServerFn(updateProxy);
  const deleteFn = useServerFn(deleteProxy);

  const { data: proxies = [], isLoading } = useQuery({
    queryKey: ["proxies"],
    queryFn: () => listFn(),
  });

  const [form, setForm] = useState<FormState | null>(null);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const base = {
        label: f.label,
        country: f.country,
        provider: f.provider,
        kind: f.kind,
        protocol: f.protocol,
        host: f.host,
        port: Number(f.port),
        username: f.username || undefined,
        password: f.password || undefined,
        notes: f.notes,
        is_active: f.is_active,
      };
      if (f.id) {
        return updateFn({
          data: { ...base, id: f.id, clearPassword: f.clearPassword },
        });
      }
      return createFn({ data: base });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success("Proxy mentve");
      setForm(null);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Mentés sikertelen");
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success("Proxy törölve");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Törlés sikertelen");
    },
  });

  function startEdit(p: ProxyRow) {
    setForm({
      id: p.id,
      label: p.label,
      country: p.country,
      provider: p.provider,
      kind: p.kind as FormState["kind"],
      protocol: p.protocol as FormState["protocol"],
      host: p.host,
      port: p.port,
      username: "",
      password: "",
      notes: p.notes,
      is_active: p.is_active,
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Globe className="size-6" /> Proxyk
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Titkosított proxy tár. A felhasználónév és jelszó AES-256-GCM
            titkosítással kerül tárolásra; a szerver csak futtatáskor fejti
            vissza, a böngésző soha nem látja őket.
          </p>
        </div>
        <Button
          onClick={() => setForm(emptyForm())}
          disabled={form !== null}
          className="gap-2"
        >
          <Plus className="size-4" /> Új proxy
        </Button>
      </div>

      {form && (
        <ProxyForm
          value={form}
          onChange={setForm}
          onCancel={() => setForm(null)}
          onSave={() => saveMut.mutate(form)}
          saving={saveMut.isPending}
        />
      )}

      <div className="mt-6 space-y-2">
        {isLoading && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Betöltés…
          </div>
        )}
        {!isLoading && proxies.length === 0 && !form && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Még nincs mentett proxy. Add hozzá az elsőt a jobb felső gombbal.
          </div>
        )}
        {proxies.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-4 rounded-md border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{p.label}</span>
                {p.country && (
                  <Badge variant="secondary" className="text-[10px]">
                    {p.country}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {p.kind}
                </Badge>
                {!p.is_active && (
                  <Badge variant="destructive" className="text-[10px]">
                    inaktív
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {p.protocol}://{p.usernameMasked ?? "(nincs)"}
                {p.hasPassword ? ":••••" : ""}@{p.host}:{p.port}
                {p.provider ? ` · ${p.provider}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => startEdit(p)}
                aria-label="Szerkesztés"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Biztosan törlöd: ${p.label}?`)) {
                    deleteMut.mutate(p.id);
                  }
                }}
                aria-label="Törlés"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProxyForm({
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  value: FormState;
  onChange: (f: FormState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const isEdit = !!value.id;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="label">Név *</Label>
          <Input
            id="label"
            value={value.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder="pl. Amsterdam IPRoyal ISP"
          />
        </div>
        <div>
          <Label htmlFor="country">Ország (2-betűs kód)</Label>
          <Input
            id="country"
            value={value.country}
            onChange={(e) => set("country", e.target.value.toUpperCase())}
            placeholder="NL"
            maxLength={4}
          />
        </div>
        <div>
          <Label htmlFor="provider">Szolgáltató</Label>
          <Input
            id="provider"
            value={value.provider}
            onChange={(e) => set("provider", e.target.value)}
            placeholder="IPRoyal"
          />
        </div>
        <div>
          <Label>Típus</Label>
          <Select value={value.kind} onValueChange={(v) => set("kind", v as FormState["kind"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="isp">ISP</SelectItem>
              <SelectItem value="residential">Residential</SelectItem>
              <SelectItem value="datacenter">Datacenter</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Protokoll</Label>
          <Select value={value.protocol} onValueChange={(v) => set("protocol", v as FormState["protocol"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="socks5">SOCKS5</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <Label htmlFor="host">Host *</Label>
          <Input
            id="host"
            value={value.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="proxy.example.com"
          />
        </div>
        <div>
          <Label htmlFor="port">Port *</Label>
          <Input
            id="port"
            type="number"
            value={value.port}
            onChange={(e) => set("port", Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label htmlFor="username">Felhasználónév {isEdit && <span className="text-muted-foreground text-xs">(üresen hagyva: nem változik; kitöltve: felülírja)</span>}</Label>
          <Input
            id="username"
            value={value.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder={isEdit ? "•••• (változatlan)" : ""}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="password">Jelszó {isEdit && <span className="text-muted-foreground text-xs">(üresen hagyva: nem változik)</span>}</Label>
          <Input
            id="password"
            type="password"
            value={value.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={isEdit ? "•••• (változatlan)" : ""}
            autoComplete="new-password"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="notes">Megjegyzés</Label>
          <Textarea
            id="notes"
            value={value.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={value.is_active}
            onCheckedChange={(v) => set("is_active", v)}
            id="is_active"
          />
          <Label htmlFor="is_active">Aktív</Label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="mr-1 size-4" /> Mégse
        </Button>
        <Button
          onClick={onSave}
          disabled={saving || !value.label.trim() || !value.host.trim() || !value.port}
        >
          <Check className="mr-1 size-4" />
          {isEdit ? "Mentés" : "Létrehozás"}
        </Button>
      </div>
    </div>
  );
}
