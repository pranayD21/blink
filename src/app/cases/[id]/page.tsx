import { notFound } from "next/navigation";
import { RoleGate } from "@/components/app/role-gate";
import { AnalystCase } from "@/components/workspace/analyst-case";
import type { TranscriptSample } from "@/components/workspace/upload-transcript";
import { Workspace } from "@/components/workspace/workspace";
import { DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { analystCaseView } from "@/server/services/cases";
import { readFixtureText } from "@/server/services/seed";
import { loadWorkspace } from "@/server/services/workspace";

/** The seeded Halvorsen case offers its two synthetic transcripts as one-click samples. */
function samplesFor(ticker: string): TranscriptSample[] {
  if (ticker !== "HLVP") return [];
  try {
    return [
      { label: "Fixture: transcript v1", filename: "transcript-v1.txt", sourceLabel: "Meridian transcript v1", text: readFixtureText("cases", "halvorsen", "transcript-v1.txt") },
      { label: "Fixture: transcript v2 (T19 corrected)", filename: "transcript-v2.txt", sourceLabel: "Meridian transcript v2 (corrected)", text: readFixtureText("cases", "halvorsen", "transcript-v2.txt") },
    ];
  } catch {
    return [];
  }
}

const allowGold = () => process.env.NODE_ENV !== "production" || process.env.BLINK_ALLOW_GOLD === "1";

export default async function CasePage({ params }: PageProps<"/cases/[id]">) {
  const { id } = await params;
  const actor = await pageActor();
  const db = getDb();

  if (actor.role === "analyst") {
    // Another banker's case is the same 404 page as one that does not exist.
    const view = orNull(() => analystCaseView(db, id, actor));
    if (!view) notFound();
    return <AnalystCase view={view} samples={samplesFor(view.case.ticker)} allowGold={allowGold()} />;
  }
  if (!isReviewer(actor)) {
    return <RoleGate title="The review workspace is for compliance" message="Findings, evidence, and dispositions are visible to compliance reviewers only." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "reviewer" || u.role === "senior_reviewer")} />;
  }
  const payload = orNull(() => loadWorkspace(db, id, actor));
  if (!payload) notFound();
  return <Workspace payload={payload} samples={samplesFor(payload.case.ticker)} allowGold={allowGold()} />;
}

/** A 404 from the service becomes null, so the page shows Next's not-found page. */
function orNull<T>(load: () => T): T | null {
  try {
    return load();
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}
