import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { CallsOverviewView } from "@/components/calls/calls-overview";
import { DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { callsOverview } from "@/server/services/observability";

/** All calls: is Blink working? For compliance and the policy owner; a banker is refused, as the API refuses them. */
export default async function CallsPage() {
  const actor = await pageActor();
  if (actor.role === "analyst") {
    return <RoleGate title="Calls are for compliance" message="This page shows how every call went, which only compliance reviewers and the policy owner may see." current={actor} switchTo={DEMO_USERS.filter((u) => u.role !== "analyst")} />;
  }
  return (
    <PageShell className="max-w-4xl" title="Is Blink working?" description="How fast warnings reach the banker, the parts that can fail, and every recent problem. The figures cover every call so far.">
      <CallsOverviewView overview={callsOverview(getDb(), actor)} canOpen={isReviewer(actor)} />
    </PageShell>
  );
}
