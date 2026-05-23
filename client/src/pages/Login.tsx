import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { AlertCircle, LogIn } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

function getReturnToPath() {
  if (typeof window === "undefined") return "/";
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") ? returnTo : "/";
}

export default function Login() {
  const { user, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const returnTo = useMemo(() => getReturnToPath(), []);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await refresh();
      setLocation(returnTo);
    },
    onError: error => {
      setFormError(error.message || "Unable to sign in.");
    },
  });

  useEffect(() => {
    if (user) {
      setLocation(returnTo);
    }
  }, [returnTo, setLocation, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    await loginMutation.mutateAsync({
      email,
      password,
    });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.12),_transparent_35%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.35))] px-4 py-10">
      <div className="container flex min-h-[calc(100vh-5rem)] items-center justify-center">
        <Card className="w-full max-w-md border-border/60 bg-card/95 shadow-2xl backdrop-blur">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LogIn className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              Sign in to Stock Watch Monitor
            </CardTitle>
            <CardDescription>
              Use the account created for you by an administrator to access your watchlist dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  required
                />
              </div>

              {formError ? (
                <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              ) : null}

              <Button className="w-full" type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
