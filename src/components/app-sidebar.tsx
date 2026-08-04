import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Check,
  X,
  Copy,
  Globe,
  ClipboardCheck,
  ClipboardPaste,
  Inbox,
  ShieldCheck,
  Radar,
  Flame,
  Folder,
  FolderPlus,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FolderInput,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { readStoredSupabaseSession } from "@/lib/auth-session";
import { renameWorkflow, duplicateWorkflow } from "@/lib/chat.functions";
import { useModule } from "@/lib/module/provider";
import type { AppModule } from "@/lib/module/types";
import logo from "@/assets/kylo-brain-logo.png";

type Workflow = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  spec: unknown;
  folder_id: string | null;
};

type WorkflowFolder = {
  id: string;
  name: string;
  sort_order: number;
};

function getMonitorType(spec: unknown): string | null {
  if (!spec || typeof spec !== "object" || !("monitor_type" in spec)) return null;
  const value = (spec as { monitor_type?: unknown }).monitor_type;
  return typeof value === "string" ? value : null;
}

async function fetchWorkflows(module: AppModule): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, status, updated_at, spec, folder_id")
    .eq("module", module)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // A teszt-forgatókönyvek mögött technikai felvételi workflow is készül.
  // Ezeket kizárólag a Teszt-forgatókönyvek oldalon kezeljük; a normál
  // Workflow-k listájában csak összezavarnák a felhasználót.
  return (data ?? []).filter((workflow) => getMonitorType(workflow.spec) !== "kylo-scenario");
}

async function fetchFolders(module: AppModule): Promise<WorkflowFolder[]> {
  const { data, error } = await supabase
    .from("workflow_folders")
    .select("id, name, sort_order")
    .eq("module", module)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}



export function AppSidebar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const callRename = useServerFn(renameWorkflow);
  const callDuplicate = useServerFn(duplicateWorkflow);
  const { module, meta } = useModule();
  const currentPath = useRouterState({
    select: (s) => s.location.pathname,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ["workflows", module],
    queryFn: () => fetchWorkflows(module),
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["workflow-folders", module],
    queryFn: () => fetchFolders(module),
  });

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");

  const grouped = useMemo(() => {
    const byFolder = new Map<string, Workflow[]>();
    const loose: Workflow[] = [];
    for (const wf of workflows) {
      if (wf.folder_id && folders.some((f) => f.id === wf.folder_id)) {
        const list = byFolder.get(wf.folder_id) ?? [];
        list.push(wf);
        byFolder.set(wf.folder_id, list);
      } else {
        loose.push(wf);
      }
    }
    return { byFolder, loose };
  }, [workflows, folders]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  async function getTenantId(): Promise<string | null> {
    const uid = readStoredSupabaseSession()?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", uid)
      .maybeSingle();
    return data?.tenant_id ?? null;
  }

  async function createFolder() {
    const tenantId = await getTenantId();
    if (!tenantId) {
      toast.error("Nincs tenant hozzárendelve a felhasználóhoz.");
      return;
    }
    const { data, error } = await supabase
      .from("workflow_folders")
      .insert({ name: "Új mappa", module, tenant_id: tenantId })
      .select("id")
      .single();
    if (error) {
      toast.error(`Mappa létrehozása sikertelen: ${error.message}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflow-folders", module] });
    setFolderDraft("Új mappa");
    setEditingFolderId(data.id);
  }

  async function commitFolderName(id: string) {
    const next = folderDraft.trim();
    setEditingFolderId(null);
    if (!next) return;
    const { error } = await supabase
      .from("workflow_folders")
      .update({ name: next })
      .eq("id", id);
    if (error) {
      toast.error("Mappa átnevezése sikertelen");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflow-folders", module] });
  }

  async function deleteFolder(id: string) {
    const { error } = await supabase.from("workflow_folders").delete().eq("id", id);
    if (error) {
      toast.error("Mappa törlése sikertelen");
      return;
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["workflow-folders", module] }),
      qc.invalidateQueries({ queryKey: ["workflows", module] }),
    ]);
    toast.success("Mappa törölve — a workflow-k megmaradtak.");
  }

  async function moveWorkflow(workflowId: string, folderId: string | null) {
    const { error } = await supabase
      .from("workflows")
      .update({ folder_id: folderId })
      .eq("id", workflowId);
    if (error) {
      toast.error(`Áthelyezés sikertelen: ${error.message}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflows", module] });
  }


  async function createWorkflow() {
    const uid = readStoredSupabaseSession()?.user?.id;
    if (!uid) {
      toast.error("Nincs bejelentkezett felhasználó.");
      return;
    }
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", uid)
      .maybeSingle();
    if (pErr || !prof?.tenant_id) {
      toast.error("Nincs tenant hozzárendelve a felhasználóhoz.");
      return;
    }
    const { data, error } = await supabase
      .from("workflows")
      .insert({ name: "Új workflow", module, tenant_id: prof.tenant_id })
      .select("id")
      .single();
    if (error) {
      toast.error(`Nem sikerült létrehozni a workflow-t: ${error.message}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflows", module] });
    setDraft("");
    setEditingId(data.id);
    navigate({ to: "/w/$workflowId", params: { workflowId: data.id } });
  }

  async function deleteWorkflow(id: string) {
    const { error } = await supabase.from("workflows").delete().eq("id", id);
    if (error) {
      toast.error("Törlés sikertelen");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflows", module] });
    if (currentPath === `/w/${id}`) navigate({ to: "/" });
  }

  async function duplicateWorkflowFn(id: string) {
    try {
      const { id: newId } = await callDuplicate({ data: { workflowId: id } });
      await qc.invalidateQueries({ queryKey: ["workflows", module] });
      navigate({ to: "/w/$workflowId", params: { workflowId: newId } });
      toast.success("Workflow lemásolva");
    } catch (e) {
      console.error("duplicate failed", e);
      toast.error(e instanceof Error ? e.message : "Másolás sikertelen");
    }
  }


  function startEdit(wf: Workflow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDraft(wf.name);
    setEditingId(wf.id);
  }

  const renamingRef = useRef<string | null>(null);
  async function commitEdit(id: string) {
    if (renamingRef.current === id) return;
    const next = draft.trim();
    const original = workflows.find((w) => w.id === id)?.name ?? "";
    setEditingId(null);
    if (!next || next === original) return;
    renamingRef.current = id;
    try {
      await callRename({ data: { workflowId: id, name: next } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["workflows", module] }),
        qc.invalidateQueries({ queryKey: ["workflow", id] }),
      ]);
    } catch (e) {
      console.error("rename failed", e);
      toast.error(e instanceof Error ? `Átnevezés sikertelen: ${e.message}` : "Átnevezés sikertelen");
    } finally {
      renamingRef.current = null;
    }
  }

  function renderWorkflow(wf: Workflow) {
    const monitorType = getMonitorType(wf.spec);
    const isKyloStudyQa = module === "audit" && monitorType === "kylo-study-qa";
    const isKyloSignup = module === "audit" && monitorType === "kylo-study-signup";
    const active = isKyloStudyQa
      ? currentPath.startsWith("/audit/qa")
      : isKyloSignup
      ? currentPath.startsWith("/audit/signup")
      : currentPath === `/w/${wf.id}`;
    const isEditing = editingId === wf.id;
    const ItemIcon = isKyloStudyQa || isKyloSignup ? ClipboardCheck : MessageSquare;
    return (
      <SidebarMenuItem key={wf.id}>
        {isEditing ? (
          <div className="flex items-center gap-1 px-1 group-data-[collapsible=icon]:hidden">
            <Input
              ref={editInputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(wf.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => commitEdit(wf.id)}
              className="h-7 text-xs"
              placeholder="Workflow neve"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commitEdit(wf.id);
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="Mentés"
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setEditingId(null);
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="Mégse"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="group/item flex items-center gap-1">
            <SidebarMenuButton asChild isActive={active} className="flex-1">
              {isKyloStudyQa ? (
                <Link
                  to="/audit/qa"
                  onDoubleClick={(e) => startEdit(wf, e)}
                  className="flex items-center gap-2"
                >
                  <ItemIcon className="size-4 shrink-0" />
                  <span className="truncate">{wf.name}</span>
                </Link>
              ) : isKyloSignup ? (
                <Link
                  to="/audit/signup"
                  onDoubleClick={(e) => startEdit(wf, e)}
                  className="flex items-center gap-2"
                >
                  <ItemIcon className="size-4 shrink-0" />
                  <span className="truncate">{wf.name}</span>
                </Link>
              ) : (
                <Link
                  to="/w/$workflowId"
                  params={{ workflowId: wf.id }}
                  onDoubleClick={(e) => startEdit(wf, e)}
                  className="flex items-center gap-2"
                >
                  <ItemIcon className="size-4 shrink-0" />
                  <span className="truncate">{wf.name}</span>
                </Link>
              )}
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/item:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
                  aria-label="Mappába helyezés"
                >
                  <FolderInput className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>Áthelyezés mappába</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {folders.length === 0 && (
                  <DropdownMenuItem disabled>Még nincs mappa</DropdownMenuItem>
                )}
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    disabled={wf.folder_id === f.id}
                    onSelect={() => moveWorkflow(wf.id, f.id)}
                  >
                    <Folder className="size-4" />
                    {f.name}
                  </DropdownMenuItem>
                ))}
                {wf.folder_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => moveWorkflow(wf.id, null)}>
                      <X className="size-4" />
                      Kivétel a mappából
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={(e) => startEdit(wf, e)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/item:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
              aria-label="Átnevezés"
            >
              <Pencil className="size-3.5" />
            </button>
            {!isKyloStudyQa && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  duplicateWorkflowFn(wf.id);
                }}
                className="hidden size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/item:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden md:flex"
                aria-label="Másolat készítése"
              >
                <Copy className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                deleteWorkflow(wf.id);
              }}
              className="hidden size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/item:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden md:flex"
              aria-label="Törlés"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </SidebarMenuItem>
    );
  }

  return (

    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-2 py-1.5">
          <img
            src={logo}
            alt={meta.fullName}
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {meta.fullName}
          </span>
        </Link>
      </SidebarHeader>


      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-1.5 px-2">
            <Button
              size="sm"
              className="w-full justify-start gap-2"
              onClick={createWorkflow}
            >
              <Plus className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                Új workflow
              </span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={createFolder}
            >
              <FolderPlus className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                Új mappa
              </span>
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>


        {module === "audit" && (
          <SidebarGroup>
            <SidebarGroupLabel>Audit eszközök</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath.startsWith("/audit/qa")}>
                    <Link to="/audit/qa" className="flex items-center gap-2">
                      <ClipboardCheck className="size-4 shrink-0" />
                      <span className="truncate">Kylo.study QA</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath.startsWith("/audit/signup")}>
                    <Link to="/audit/signup" className="flex items-center gap-2">
                      <ClipboardCheck className="size-4 shrink-0" />
                      <span className="truncate">Kylo Sign Up</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath.startsWith("/audit/scenarios")}>
                    <Link to="/audit/scenarios" className="flex items-center gap-2">
                      <ClipboardCheck className="size-4 shrink-0" />
                      <span className="truncate">Teszt-forgatókönyvek</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>

            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Workflow-k</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  Betöltés…
                </div>
              )}
              {!isLoading && workflows.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Még nincs workflow.
                </div>
              )}
              {folders.map((folder) => {
                const items = grouped.byFolder.get(folder.id) ?? [];
                const isOpen = !collapsed[folder.id];
                return (
                  <SidebarMenuItem key={folder.id} className="flex-col items-stretch">
                    <div className="group/folder flex items-center gap-1">
                      {editingFolderId === folder.id ? (
                        <Input
                          autoFocus
                          value={folderDraft}
                          onChange={(e) => setFolderDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitFolderName(folder.id);
                            if (e.key === "Escape") setEditingFolderId(null);
                          }}
                          onBlur={() => commitFolderName(folder.id)}
                          className="h-7 text-xs"
                          placeholder="Mappa neve"
                        />
                      ) : (
                        <>
                          <SidebarMenuButton
                            className="flex-1"
                            onClick={() =>
                              setCollapsed((c) => ({ ...c, [folder.id]: isOpen }))
                            }
                            onDoubleClick={() => {
                              setFolderDraft(folder.name);
                              setEditingFolderId(folder.id);
                            }}
                          >
                            {isOpen ? (
                              <ChevronDown className="size-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="size-3.5 shrink-0" />
                            )}
                            {isOpen ? (
                              <FolderOpen className="size-4 shrink-0" />
                            ) : (
                              <Folder className="size-4 shrink-0" />
                            )}
                            <span className="truncate font-medium">{folder.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {items.length}
                            </span>
                          </SidebarMenuButton>
                          <button
                            type="button"
                            onClick={() => {
                              setFolderDraft(folder.name);
                              setEditingFolderId(folder.id);
                            }}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
                            aria-label="Mappa átnevezése"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteFolder(folder.id)}
                            className="hidden size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/folder:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden md:flex"
                            aria-label="Mappa törlése"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                    {isOpen && (
                      <div className="mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2 group-data-[collapsible=icon]:hidden">
                        {items.length === 0 && (
                          <div className="px-2 py-1 text-xs text-muted-foreground">
                            Üres mappa
                          </div>
                        )}
                        {items.map((wf) => renderWorkflow(wf))}
                      </div>
                    )}
                  </SidebarMenuItem>
                );
              })}

              {folders.length > 0 && grouped.loose.length > 0 && (
                <div className="px-2 pt-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Mappa nélkül
                </div>
              )}
              {grouped.loose.map((wf) => renderWorkflow(wf))}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Erőforrások</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {module === "brain" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/inbox"}>
                    <Link to="/inbox" className="flex items-center gap-2">
                      <Inbox className="size-4 shrink-0" />
                      <span className="truncate">Reddit Inbox</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {module === "brain" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/reddit-scout"}>
                    <Link to="/reddit-scout" className="flex items-center gap-2">
                      <Radar className="size-4 shrink-0" />
                      <span className="truncate">Reddit Scout</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {module === "brain" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/reddit-warmup"}>
                    <Link to="/reddit-warmup" className="flex items-center gap-2">
                      <Flame className="size-4 shrink-0" />
                      <span className="truncate">Reddit Warmup</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {module === "brain" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/patrol"}>
                    <Link to="/patrol" className="flex items-center gap-2">
                      <ShieldCheck className="size-4 shrink-0" />
                      <span className="truncate">Poszt-őrjárat</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {module === "brain" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/content"}>
                    <Link to="/content" className="flex items-center gap-2">
                      <ClipboardPaste className="size-4 shrink-0" />
                      <span className="truncate">Tartalom Stúdió</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/proxies"}>
                  <Link to="/proxies" className="flex items-center gap-2">
                    <Globe className="size-4 shrink-0" />
                    <span className="truncate">Proxyk</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/worker-health"}>
                  <Link to="/worker-health" className="flex items-center gap-2">
                    <Activity className="size-4 shrink-0" />
                    <span className="truncate">Worker terhelés</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground group-data-[collapsible=icon]:hidden">
          Tenant: 0 · Dev mód
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
