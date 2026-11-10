import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { BaselineReview } from "@/components/baseline/baseline-review";
import { Button } from "@/components/ui/button";
import { type Actor, DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { baselineView } from "@/server/services/sessions";

function load(id: string, actor: Actor) {
  try {
    return baselineView(getDb(), id, actor);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

export default async function BaselinePage({ params }: PageProps<"/cases/[id]/baseline">) {
  const { id } = await params;
  const actor = await pageActor();
  if (!isReviewer(actor)) {
    return <RoleGate title="Baseline mode is for compliance reviewers" message="It times a review of the transcript without Blink's evidence, for the metrics page." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "reviewer" || u.role === "senior_reviewer")} />;
  }
  const view = load(id, actor);
  if (!view) notFound();
  const names = Object.fromEntries(getDb().select().from(users).all().map((u) => [u.id, u.name]));
  return (
    <PageShell
      title="Baseline review"
      description={`${view.case.title}. Review the call with only the transcript and a summary, the way it is done without Blink. The time you take is compared with a Blink review on the Metrics page.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/cases/${id}`}>
            <ArrowLeft /> Review workspace
          </Link>
        </Button>
      }
    >
      <BaselineReview view={view} users={names} />
    </PageShell>
  );
}
