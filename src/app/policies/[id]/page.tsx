import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/app/page-shell";
import { PolicyDetail } from "@/components/policy/policy-detail";
import { Button } from "@/components/ui/button";
import { guardToEnglish } from "@/core/policy/decompile";
import { buildGuardTree } from "@/core/policy/schema";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { llmMode } from "@/server/llm/client";
import { policyDetail } from "@/server/services/policies";

function load(id: string) {
  try {
    return policyDetail(getDb(), id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

export default async function PolicyPage({ params }: PageProps<"/policies/[id]">) {
  const { id } = await params;
  const actor = await pageActor();
  const detail = load(id);
  if (!detail) notFound();
  const guardEnglish: Record<string, string> = {};
  for (const rule of detail.rulesDoc?.rules ?? []) {
    const built = buildGuardTree(rule.guard);
    if (built.ok) guardEnglish[rule.rule_id] = guardToEnglish(built.tree);
  }
  return (
    <PageShell
      title={`Policy ${detail.label}`}
      description={detail.source.title}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/policies">
            <ArrowLeft /> Policy versions
          </Link>
        </Button>
      }
    >
      <PolicyDetail key={`${detail.id}:${detail.status}`} detail={detail} guardEnglish={guardEnglish} canEdit={actor.role === "policy_owner"} llmMode={llmMode()} />
    </PageShell>
  );
}
