"use client";

import { ChevronDown, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

export interface DemoUser {
  id: string;
  name: string;
  role: string;
}

/** Demo auth: pick one of the seeded users. The server still checks the role on every request. */
export function RoleSwitcher({ current, users }: { current: DemoUser; users: DemoUser[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function actAs(userId: string) {
    if (userId === current.id) return;
    setBusy(true);
    try {
      await api("/api/session/act-as", { body: { userId } });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 px-2.5" disabled={busy || pending} data-testid="role-switcher">
          <UserRound className="size-3.5 text-slate-500" />
          <span className="font-medium" data-testid="current-user">
            {current.name}
          </span>
          <span className="text-slate-500" data-testid="current-role">
            {ROLE_LABEL[current.role]}
          </span>
          <ChevronDown className="size-3.5 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-slate-500">Act as a demo user</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {users.map((u) => (
          <DropdownMenuItem key={u.id} onSelect={() => actAs(u.id)} data-testid={`act-as-${u.id}`} className="flex items-center justify-between gap-3">
            <span className={u.id === current.id ? "font-medium" : ""}>{u.name}</span>
            <span className="text-xs text-slate-500">{ROLE_LABEL[u.role]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
