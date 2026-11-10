import { EmptyState, PageShell } from "@/components/app/page-shell";
import { ReleasedBrief } from "@/components/brief/released-brief";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { releasedBriefs } from "@/server/services/briefs";

export default async function AnalystPage() {
  await pageActor();
  const briefs = releasedBriefs(getDb());
  return (
    <PageShell title="Released briefs" description="Research briefs that compliance has released. Each sentence cites the expert statements it rests on. Statements compliance restricted are not here, and neither are briefs still in review.">
      {briefs.length === 0 ? (
        <EmptyState>
          <span data-testid="no-released-briefs">No brief has been released yet. A brief appears here after compliance decides every finding, attests to the whole call, approves the brief, and releases it.</span>
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {briefs.map((b) => (
            <ReleasedBrief key={b.releaseId} brief={b} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
