import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { CallTrace } from "@/components/calls/call-trace";
import { formatDate } from "@/lib/format";
import { DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { type CallTraceView, callTrace } from "@/server/services/observability";

const STATUS_WORDS: Record<string, string> = { live: "still live", ended: "ended", abandoned: "abandoned: the expert never spoke" };

function lengthOf(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`;
}

/** One call's record, moment by moment. For compliance reviewers only: it shows what was said, hidden passages included. */
export default async function CallPage({ params }: PageProps<"/calls/[id]">) {
  const { id } = await params;
  const actor = await pageActor();
  if (!isReviewer(actor)) {
    return <RoleGate title="A call's record is for compliance" message="It shows what was said on the call, passages hidden from the banker included, which only compliance reviewers may read." current={actor} switchTo={DEMO_USERS.filter(isReviewer)} />;
  }
  let view: CallTraceView;
  try {
    view = callTrace(getDb(), id, actor);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  const facts = [formatDate(view.call.startedAt), lengthOf(view.call.durationMs), STATUS_WORDS[view.call.status] ?? view.call.status].filter(Boolean).join(" · ");
  return (
    <PageShell
      className="max-w-4xl"
      title={view.call.title}
      description={`${facts}. Each moment, in order.`}
      actions={
        <>
          <Link href="/calls" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            All calls
          </Link>
          <Link href={`/cases/${view.call.caseId}`} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Review the case
          </Link>
        </>
      }
    >
      <CallTrace view={view} />
    </PageShell>
  );
}
