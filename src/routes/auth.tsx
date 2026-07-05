import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { readStoredSupabaseSession, saveSupabaseSession } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Bejelentkezés — KyloBrain" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();

  // If already signed in, redirect to home.
  useEffect(() => {
    if (readStoredSupabaseSession()?.user) navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Brain className="size-10 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">KyloBrain</h1>
          <p className="text-sm text-muted-foreground">
            Jelentkezz be a folytatáshoz
          </p>
        </div>

        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Bejelentkezés</TabsTrigger>
            <TabsTrigger value="signup">Regisztráció</TabsTrigger>
          </TabsList>
          <TabsContent value="signin">
            <SignInForm
              onSuccess={() => window.location.replace("/")}
            />
          </TabsContent>
          <TabsContent value="signup">
            <SignUpForm
              onSuccess={() => navigate({ to: "/", replace: true })}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/public/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        session?: Session;
        error?: string;
      };
      if (!res.ok || !payload.session) {
        throw new Error(payload.error ?? "Sikertelen bejelentkezés.");
      }
      saveSupabaseSession(payload.session);
      onSuccess();
    } catch (error) {
      toast.error("Sikertelen bejelentkezés", {
        description: error instanceof Error ? error.message : "Ismeretlen hiba.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="signin-email">E-mail</Label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-password">Jelszó</Label>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Bejelentkezés…" : "Bejelentkezés"}
      </Button>
    </form>
  );
}

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Sikertelen regisztráció", { description: error.message });
      return;
    }
    toast.success("Sikeres regisztráció");
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="signup-email">E-mail</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Jelszó</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Regisztráció…" : "Regisztráció"}
      </Button>
    </form>
  );
}
