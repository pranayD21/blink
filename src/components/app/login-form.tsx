"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/**
 * Sign in, or open a banker account. Both talk to the server and then reload at `next`.
 * There is no other sign-in method: a button that cannot sign you in is not shown.
 */
export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") await api("/api/session/register", { body: { name, email, password } });
      else await api("/api/session/login", { body: { email, password } });
      window.location.assign(next);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
      setBusy(false);
    }
  }

  const creating = mode === "create";

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-testid="login-form">
      <section className="flex flex-1 items-center justify-center px-8 py-12">
        <div className="w-full max-w-md">
          <h1 className="font-serif text-4xl leading-tight text-foreground md:text-5xl">{creating ? "Create an account" : "Sign in"}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{creating ? "A banker account. You can open calls and read what compliance has released." : "Blink, for the people on the call and the people who review it."}</p>

          <form className="mt-8 space-y-4" onSubmit={submit}>
            {creating && (
              <Field label="Name">
                <input name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="auth-input" data-testid="register-name" />
              </Field>
            )}
            <Field label="Email">
              <input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" data-testid="login-email" />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={creating ? "new-password" : "current-password"}
                  required
                  minLength={creating ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input pr-16"
                  data-testid="login-password"
                />
                <button type="button" className="absolute inset-y-0 right-3 text-xs text-muted-foreground" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive" data-testid="login-error">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-2 h-11 w-full" disabled={busy} data-testid={creating ? "register-submit" : "login-submit"}>
              {busy ? "Working" : creating ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            {creating ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              className="text-foreground"
              data-testid="toggle-account"
              onClick={() => {
                setMode(creating ? "sign-in" : "create");
                setError(null);
              }}
            >
              {creating ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </section>

      <section className="relative hidden flex-1 md:block">
        <div className="aurora-field" aria-hidden />
        <div className="absolute inset-0 flex items-end p-12">
          <p className="max-w-sm font-serif text-3xl leading-snug text-foreground">Each turn is read, then checked against the firm&apos;s policy, while the call is still going.</p>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted-foreground">{label}</span>
      <span className="auth-field">{children}</span>
    </label>
  );
}
