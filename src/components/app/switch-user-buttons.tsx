"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

/** Switcher mode only: one button per demo user who may open the page the role gate is guarding. */
export function SwitchUserButtons({ users }: { users: { id: string; name: string; role: string }[] }) {
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
    <div className="mt-4 flex flex-wrap gap-2">
      {users.map((u) => (
        <Button key={u.id} size="sm" variant="outline" onClick={() => actAs(u.id)}>
          Switch to {u.name} ({ROLE_LABEL[u.role]?.toLowerCase()})
        </Button>
      ))}
    </div>
  );
}
