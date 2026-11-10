import Link from "next/link";
import { DEMO_USERS } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { NavLinks } from "./nav-links";
import { RoleSwitcher } from "./role-switcher";

const NAV: Record<string, { href: string; label: string }[]> = {
  analyst: [
    { href: "/", label: "Cases" },
    { href: "/analyst", label: "Released briefs" },
    { href: "/metrics", label: "Metrics" },
  ],
  reviewer: [
    { href: "/", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/metrics", label: "Metrics" },
  ],
  senior_reviewer: [
    { href: "/", label: "Cases" },
    { href: "/documents", label: "Documents" },
    { href: "/policies", label: "Policy" },
    { href: "/metrics", label: "Metrics" },
  ],
  policy_owner: [
    { href: "/", label: "Cases" },
    { href: "/policies", label: "Policy" },
    { href: "/metrics", label: "Metrics" },
  ],
};

export async function AppHeader() {
  const actor = await pageActor();
  return (
    <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-4 border-b bg-white px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
        <span className="grid size-6 place-items-center rounded-md bg-indigo-600 text-[13px] font-bold text-white">B</span>
        Blink
      </Link>
      <NavLinks links={NAV[actor.role] ?? NAV.reviewer} />
      <div className="ml-auto flex items-center gap-3">
        {/* Permanent: every screen of this demo shows that the data is synthetic. */}
        <span data-testid="synthetic-pill" className="inline-flex h-6 items-center rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold tracking-wide text-amber-800 uppercase ring-1 ring-amber-200 ring-inset">
          Synthetic data
        </span>
        <RoleSwitcher current={actor} users={[...DEMO_USERS]} />
      </div>
    </header>
  );
}
