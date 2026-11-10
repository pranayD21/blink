"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/api";
import { LOGIN_PATH } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";

/** Password mode: who is signed in, and "Sign out". The role comes from the account and cannot be changed here. */
export function AccountMenu({ current }: { current: { name: string; role: string } }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api("/api/session/logout", { method: "POST" });
      window.location.assign(LOGIN_PATH);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 px-2.5" disabled={busy} data-testid="account-menu">
          <UserRound className="size-3.5 text-muted-foreground" />
          <span className="font-medium" data-testid="current-user">
            {current.name}
          </span>
          <span className="text-muted-foreground" data-testid="current-role">
            {ROLE_LABEL[current.role]}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Signed in as {current.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} data-testid="sign-out">
          <LogOut className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
