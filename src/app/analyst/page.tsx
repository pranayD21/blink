import { EmptyState, PageShell } from "@/components/app/page-shell";
import { ReleasedBrief } from "@/components/brief/released-brief";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { releasedBriefs } from "@/server/services/briefs";

export default async function AnalystPage() {
  const actor = await pageActor();
  const briefs = releasedBriefs(getDb(), actor);
  return (
    <PageShell title="Released briefs" description="Briefs compliance has released.">
      {briefs.length === 0 ? (
        <EmptyState>
          <span data-testid="no-released-briefs">No briefs yet.</span>
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
