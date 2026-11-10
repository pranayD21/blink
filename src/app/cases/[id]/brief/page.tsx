import { notFound } from "next/navigation";
import { RoleGate } from "@/components/app/role-gate";
import { BriefWorkspace } from "@/components/brief/brief-workspace";
import { type Actor, DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { llmMode } from "@/server/llm/client";
import { briefWorkspace, latestDraftJob } from "@/server/services/briefs";

function load(id: string, actor: Actor) {
  try {
    return briefWorkspace(getDb(), id, actor);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

export default async function BriefPage({ params }: PageProps<"/cases/[id]/brief">) {
  const { id } = await params;
  const actor = await pageActor();
  if (!isReviewer(actor)) {
    return <RoleGate title="The brief workspace is for compliance" message="Unreleased briefs are visible to compliance reviewers only. Analysts see a brief once it is released." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "reviewer" || u.role === "senior_reviewer")} />;
  }
  const payload = load(id, actor);
  if (!payload) notFound();
  return <BriefWorkspace payload={payload} draftJob={latestDraftJob(getDb(), id)} llmMode={llmMode()} />;
}
