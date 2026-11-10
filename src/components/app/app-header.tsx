import Link from "next/link";
import { DEMO_USERS } from "@/server/auth/actor";
import { authMode } from "@/server/auth/mode";
import { optionalPageActor } from "@/server/auth/session";
import { llmMode } from "@/server/llm/client";
import { BlinkMark } from "@/components/home/blink-mark";
import { AccountMenu } from "./account-menu";
import { GlassNav } from "./glass-nav";
import { RoleSwitcher } from "./role-switcher";
import { StatusDot } from "./status-dot";

const NAV: Record<string, { href: string; label: string }[]> = {
  analyst: [
    { href: "/call", label: "Call" },
    { href: "/cases", label: "Cases" },
    { href: "/analyst", label: "Released briefs" },
  ],
  reviewer: [
    { href: "/cases", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
  senior_reviewer: [
    { href: "/cases", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
  policy_owner: [
    { href: "/cases", label: "Cases" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
};

const HEADER_CLASS = "glass-bar sticky top-0 z-40 flex h-16 shrink-0 items-center gap-4 px-5";

/**
 * Never redirects, so the sign-in page cannot loop. With nobody signed in (password mode, on the
 * sign-in page) it shows only the name. Otherwise the role switcher in switcher mode, or the
 * signed-in account with "Sign out" in password mode.
 */
export async function AppHeader() {
  const actor = await optionalPageActor();
  if (!actor) {
    return (
      <header className={HEADER_CLASS}>
        <Link href="/" className="glass-press text-foreground" aria-label="Blink home">
          <BlinkMark />
        </Link>
      </header>
    );
  }
  const mode = llmMode();
  return (
    <header className={HEADER_CLASS}>
      <Link href="/" className="glass-press text-foreground" aria-label="Blink home">
        <BlinkMark />
      </Link>
      <GlassNav links={NAV[actor.role] ?? NAV.reviewer} />
      <div className="ml-auto flex items-center gap-3">
        {mode !== "live" && (
          <span
            data-testid="llm-mode"
            title={mode === "replay" ? "Model responses are served from committed recordings. No network call is made." : "Model responses are recorded as they are made; a request that already has a recording is served from it."}
            className="text-xs text-muted-foreground"
          >
            <StatusDot tone="ring">{mode === "replay" ? "Replay mode" : "Record mode"}</StatusDot>
          </span>
        )}
        {/* Permanent: every screen of this demo shows that the data is synthetic. */}
        <span data-testid="synthetic-pill" className="text-xs text-muted-foreground">
          <StatusDot tone="warn">Synthetic data</StatusDot>
        </span>
        {authMode() === "switcher" ? <RoleSwitcher current={actor} users={[...DEMO_USERS]} /> : <AccountMenu current={actor} />}
      </div>
    </header>
  );
}
