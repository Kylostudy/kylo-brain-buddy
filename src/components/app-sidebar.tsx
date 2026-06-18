import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/kylo-brain-logo.png";

type Workflow = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

async function fetchWorkflows(): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, status, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function AppSidebar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentPath = useRouterState({
    select: (s) => s.location.pathname,
  });

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  async function createWorkflow() {
    const { data, error } = await supabase
      .from("workflows")
      .insert({ name: "Új workflow" })
      .select("id")
      .single();
    if (error) {
      toast.error("Nem sikerült létrehozni a workflow-t");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflows"] });
    navigate({ to: "/w/$workflowId", params: { workflowId: data.id } });
  }

  async function deleteWorkflow(id: string) {
    const { error } = await supabase.from("workflows").delete().eq("id", id);
    if (error) {
      toast.error("Törlés sikertelen");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["workflows"] });
    if (currentPath === `/w/${id}`) navigate({ to: "/" });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-2 py-1.5">
          <img
            src={logo}
            alt="KyloBrain"
            width={28}
            height={28}
            className="size-7 shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            KyloBrain
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
                return (
                  <SidebarMenuItem key={wf.id}>
                    <div className="group/item flex items-center gap-1">
                      <SidebarMenuButton asChild isActive={active} className="flex-1">
                        <Link
                          to="/w/$workflowId"
                          params={{ workflowId: wf.id }}
                          className="flex items-center gap-2"
                        >
                          <MessageSquare className="size-4 shrink-0" />
                          <span className="truncate">{wf.name}</span>
                        </Link>
                      </SidebarMenuButton>
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
                  </SidebarMenuItem>
                );
              })}
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
