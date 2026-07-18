import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { clearStoredSupabaseSession, readStoredSupabaseSession } from "@/lib/auth-session";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { HubTenantBootstrap } from "@/components/hub-tenant-bootstrap";
import { ModuleSwitcher } from "@/components/module-switcher";
import { useModule } from "@/lib/module/provider";
import { LogOut } from "lucide-react";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const session = readStoredSupabaseSession();
    if (!session?.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();

  // Redirect to /auth on sign-out from another tab.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        navigate({ to: "/auth", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSignOut() {
    await supabase.auth.signOut({ scope: "local" });
    clearStoredSupabaseSession();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <HubTenantBootstrap />
      <AppShell onSignOut={handleSignOut}>
        <Outlet />
      </AppShell>
    </>
  );
}

function AppShell({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const { meta } = useModule();
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm font-medium text-foreground">{meta.fullName}</span>
            </div>
            <div className="flex items-center gap-2">
              <ModuleSwitcher />
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={onSignOut}
                title="Kijelentkezés"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

