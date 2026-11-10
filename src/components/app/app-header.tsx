import Link from "next/link";
import { DEMO_USERS } from "@/server/auth/actor";
import { authMode } from "@/server/auth/mode";
import { optionalPageActor } from "@/server/auth/session";
import { llmMode } from "@/server/llm/client";
import { AccountMenu } from "./account-menu";
import { NavLinks } from "./nav-links";
import { RoleSwitcher } from "./role-switcher";
import { StatusDot } from "./status-dot";

const NAV: Record<string, { href: string; label: string }[]> = {
  analyst: [
    { href: "/", label: "Cases" },
    { href: "/analyst", label: "Released briefs" },
  ],
  reviewer: [
    { href: "/", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
  senior_reviewer: [
    { href: "/", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
  policy_owner: [
    { href: "/", label: "Cases" },
    { href: "/policies", label: "Policy" },
    { href: "/calls", label: "Calls" },
    { href: "/metrics", label: "Metrics" },
  ],
};

const HEADER_CLASS = "glass-bar sticky top-0 z-40 flex h-12 shrink-0 items-center gap-4 px-4";
const BRAND_CLASS = "flex items-center gap-2 font-semibold tracking-tight text-foreground";
const Mark = () => <span className="grid size-6 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">B</span>;

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
        <span className={BRAND_CLASS}>
          <Mark />
          Blink
        </span>
      </header>
    );
  }
  const mode = llmMode();
  return (
    <header className={HEADER_CLASS}>
      <Link href="/" className={BRAND_CLASS}>
        <Mark />
        Blink
      </Link>
      <NavLinks links={NAV[actor.role] ?? NAV.reviewer} />
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
