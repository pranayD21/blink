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
    return <RoleGate title="Cases are opened by analysts" message="The analyst who ran the call fills in the case packet and uploads the transcript." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "analyst")} />;
  }
  return (
    <PageShell
      title="New case"
      description="The case packet tells Blink which company the call was about, what its fiscal calendar is, and who the expert is. Those facts are what the policy rules are checked against."
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft /> Case queue
          </Link>
        </Button>
      }
    >
      <NewCaseForm />
    </PageShell>
  );
}
