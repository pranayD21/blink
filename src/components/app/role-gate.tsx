"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

/** Shown instead of a page the current role may not open. The API refuses the same request with 403. */
export function RoleGate({ title, message, current, switchTo }: { title: string; message: string; current: { name: string; role: string }; switchTo: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  async function actAs(userId: string) {
    try {
      await api("/api/session/act-as", { body: { userId } });
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border bg-white p-6 text-sm" data-testid="role-gate">
      <div className="flex items-center gap-2 font-semibold text-slate-900">
        <ShieldAlert className="size-4 text-amber-600" />
        {title}
      </div>
      <p className="mt-2 text-slate-600">{message}</p>
      <p className="mt-1 text-slate-500">
        You are acting as {current.name} ({ROLE_LABEL[current.role]?.toLowerCase()}).
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {switchTo.map((u) => (
          <Button key={u.id} size="sm" variant="outline" onClick={() => actAs(u.id)}>
            Switch to {u.name} ({ROLE_LABEL[u.role]?.toLowerCase()})
          </Button>
        ))}
      </div>
    </div>
  );
}
