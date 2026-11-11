import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { NewCaseForm } from "@/components/cases/new-case-form";
import { Button } from "@/components/ui/button";
import { DEMO_USERS } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";

export default async function NewCasePage() {
  const actor = await pageActor();
  if (actor.role !== "analyst") {
    return <RoleGate title="Cases are opened by bankers" message="The banker who ran the call fills in the case packet and uploads the transcript." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "analyst")} />;
  }
  return (
    <PageShell
      title="New case"
      description="The company, its calendar, and the expert."
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/cases">
            <ArrowLeft /> Case queue
          </Link>
        </Button>
      }
    >
      <NewCaseForm />
    </PageShell>
  );
}
