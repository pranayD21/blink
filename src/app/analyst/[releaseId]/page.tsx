import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { ReleasedTranscriptView } from "@/components/brief/released-transcript";
import { formatDateTime } from "@/lib/format";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { releasedTranscript } from "@/server/services/released";

export default async function ReleasedTranscriptPage({ params }: PageProps<"/analyst/[releaseId]">) {
  const { releaseId } = await params;
  const actor = await pageActor();
  let view: ReturnType<typeof releasedTranscript>;
  try {
    view = releasedTranscript(getDb(), releaseId, actor);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  return (
    <PageShell
      title={view.release.caseTitle}
      description={`Released ${formatDateTime(view.release.releasedAt)}. Hidden passages are blank.`}
      actions={
        <Link href="/analyst" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to released briefs
        </Link>
      }
    >
      <ReleasedTranscriptView view={view} />
    </PageShell>
  );
}
