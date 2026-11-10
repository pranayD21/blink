import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { Button } from "@/components/ui/button";
import { DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { listAudit } from "@/server/audit/log";
import { getDb } from "@/server/db/client";
import { cases, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export default async function AuditPage({ params }: PageProps<"/cases/[id]/audit">) {
  const { id } = await params;
  const actor = await pageActor();
  if (!isReviewer(actor)) {
    return <RoleGate title="The audit log of a case is for compliance" message="It names findings and decisions, which only compliance reviewers may read." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "reviewer" || u.role === "senior_reviewer")} />;
  }
  const db = getDb();
  const row = db.select().from(cases).where(eq(cases.id, id)).get();
  if (!row) notFound();
  const names = Object.fromEntries(db.select().from(users).all().map((u) => [u.id, u.name]));
  return (
    <PageShell
      title="Audit log"
      description={`${row.title}. Who did what, when, and on which evidence. Append-only and hash-chained.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/cases/${id}`}>
            <ArrowLeft /> Review workspace
          </Link>
        </Button>
      }
    >
      <AuditTimeline events={listAudit(db, id)} users={names} scope="this case" />
    </PageShell>
  );
}
