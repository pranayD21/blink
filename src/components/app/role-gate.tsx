import { ShieldAlert } from "lucide-react";
import { ROLE_LABEL } from "@/lib/format";
import { authMode } from "@/server/auth/mode";
import { SwitchUserButtons } from "./switch-user-buttons";

const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

/**
 * Shown instead of a page the current role may not open. The API refuses the same request with 403.
 * With the role switcher it offers the demo users who may open it; with password sign-in there is
 * nobody to switch to, so it only says which roles may.
 */
export function RoleGate({ title, message, current, switchTo }: { title: string; message: string; current: { name: string; role: string }; switchTo: { id: string; name: string; role: string }[] }) {
  const switcher = authMode() === "switcher";
  const roles = [...new Set(switchTo.map((u) => u.role))].map((r) => withArticle((ROLE_LABEL[r] ?? r).toLowerCase()));
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border bg-card p-6 text-sm" data-testid="role-gate">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <ShieldAlert className="size-4 text-warning" />
        {title}
      </div>
      <p className="mt-2 text-muted-foreground">{message}</p>
      <p className="mt-1 text-muted-foreground">
        You are {switcher ? "acting" : "signed in"} as {current.name} ({ROLE_LABEL[current.role]?.toLowerCase()}).
      </p>
      {switcher ? (
        <SwitchUserButtons users={switchTo} />
      ) : (
        roles.length > 0 && (
          <p className="mt-1 text-muted-foreground" data-testid="role-gate-who">
            Only {roles.join(" or ")} can open this page.
          </p>
        )
      )}
    </div>
  );
}
