"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

/** Email and password. On success the whole page reloads at `next`, so the header and the page render as the signed-in user. */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/session/login", { body: { email, password } });
      window.location.assign(next);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6 text-sm" data-testid="login-form">
      <h1 className="text-base font-semibold text-foreground">Sign in to Blink</h1>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
      </div>
      {error && (
        <p role="alert" className="text-destructive" data-testid="login-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} data-testid="login-submit">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
