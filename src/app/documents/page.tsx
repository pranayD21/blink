import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { DocumentCard } from "@/components/documents/document-card";
import { DEMO_USERS, isReviewer } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/services/documents";

export default async function DocumentsPage() {
  const actor = await pageActor();
  if (!isReviewer(actor)) {
    return <RoleGate title="Curated documents are managed by compliance" message="Reviewers check the facts extracted from each public document before relying on them." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "reviewer" || u.role === "senior_reviewer")} />;
  }
  const docs = listDocuments(getDb());
  return (
    <PageShell
      title="Public documents"
      description="Documents expert statements are checked against."
    >
      <div className="space-y-4">
        {docs.map((d) => (
          <DocumentCard key={d.id} doc={d} />
        ))}
      </div>
      <p className="mt-4 text-lg text-muted-foreground">Marking a fact verified changes the document, and open decisions are checked again.</p>
    </PageShell>
  );
}
