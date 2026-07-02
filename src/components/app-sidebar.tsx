import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, MessageSquare, Trash2, Pencil, Check, X, Copy, Globe } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { renameWorkflow, duplicateWorkflow } from "@/lib/chat.functions";
import { useModule } from "@/lib/module/provider";
import type { AppModule } from "@/lib/module/types";
import logo from "@/assets/kylo-brain-logo.png";

type Workflow = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

async function fetchWorkflows(module: AppModule): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, status, updated_at")
    .eq("module", module)
    .order("updated_at", { ascending: false });
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

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  async function createWorkflow() {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
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
          <SidebarGroupContent className="px-2">
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
          </SidebarGroupContent>
        </SidebarGroup>

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
              {workflows.map((wf) => {
                const active = currentPath === `/w/${wf.id}`;
                const isEditing = editingId === wf.id;
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
                          <Link
                            to="/w/$workflowId"
                            params={{ workflowId: wf.id }}
                            onDoubleClick={(e) => startEdit(wf, e)}
                            className="flex items-center gap-2"
                          >
                            <MessageSquare className="size-4 shrink-0" />
                            <span className="truncate">{wf.name}</span>
                          </Link>
                        </SidebarMenuButton>
                        <button
                          type="button"
                          onClick={(e) => startEdit(wf, e)}
                          className="hidden size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover/item:opacity-100 hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden md:flex"
                          aria-label="Átnevezés"
                        >
                          <Pencil className="size-3.5" />
                        </button>
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
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Erőforrások</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/proxies"}>
                  <Link to="/proxies" className="flex items-center gap-2">
                    <Globe className="size-4 shrink-0" />
                    <span className="truncate">Proxyk</span>
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
