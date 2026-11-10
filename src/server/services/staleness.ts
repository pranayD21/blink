/**
 * Dependencies and the staleness pass (§12.2, §12.3), service half.
 *
 * When a decision, attestation, or approval is written, the exact evidence it
 * rested on is recorded as (source, hash) edges. The staleness pass compares
 * those edges with current hashes and reopens only what depended on something
 * that changed.
 */
import { and, eq, inArray } from "drizzle-orm";
import { type DependencyEdge, evidenceHash } from "@/core/deps/hash";
import { type CurrentSource, type DependencyRow, type DependentType, type SourceType, type StaleDependent, describeStaleReasons, findStale } from "@/core/deps/staleness";
import { collectPredicates } from "@/core/policy/schema";
import { transitionBrief } from "@/core/workflow/brief";
import { appendAudit } from "../audit/log";
import type { DbOrTx } from "../db/client";
import { approvals, attestations, briefs, decisions, dependencies, documents, findings, turnLineage, turns } from "../db/schema";
import { newId } from "../ids";
import { applyCaseEvent } from "./caseStatus";
import { type FindingRow, SYSTEM_GUARD, applyFindingEvent, findingLabel, latestDecision, openTask } from "./findingsCore";
import {
  type CaseRow,
  type LoadedClaim,
  type LoadedPolicy,
  currentClaimByKey,
  currentDocumentHash,
  currentTranscript,
  getCase,
  hydrateClaims,
  loadPolicy,
  loadPublicMatch,
  publicMatchKey,
} from "./loaders";

export interface LabeledEdge extends DependencyEdge {
  sourceType: SourceType;
  sourceLabel: string;
}

export const claimLabel = (claim: Pick<LoadedClaim, "row" | "turnLabels">) => `${claim.row.logicalKey} · ${claim.turnLabels.join(", ")}`;

/** Follows turn lineage to the case's current transcript version. */
function resolveTurn(tx: DbOrTx, turnId: string, currentVersionId: string | null): CurrentSource {
  let id = turnId;
  let label: string | undefined;
  for (let hops = 0; hops < 64; hops++) {
    const turn = tx.select().from(turns).where(eq(turns.id, id)).get();
    if (!turn) return { hash: null, label };
    label = turn.label;
    if (turn.transcriptVersionId === currentVersionId) return { hash: turn.textHash, label };
    const next = tx.select().from(turnLineage).where(eq(turnLineage.oldTurnId, id)).get();
    if (!next?.newTurnId) return { hash: null, label };
    id = next.newTurnId;
  }
  return { hash: null, label };
}

/** Resolves a recorded source to its current hash (null = it no longer exists). */
export function makeResolver(tx: DbOrTx, caseRow: CaseRow): (type: SourceType, id: string) => CurrentSource {
  const transcript = currentTranscript(tx, caseRow.id);
  return (type, id) => {
    switch (type) {
      case "turn":
        return resolveTurn(tx, id, transcript?.id ?? null);
      case "claim": {
        const row = currentClaimByKey(tx, caseRow.id, id);
        if (!row || row.status === "rejected") return { hash: null };
        const [claim] = hydrateClaims(tx, [row]);
        return { hash: row.contentHash, label: claimLabel(claim) };
      }
      case "context_fact": {
        // Keys look like `public_match:C3`; the effective fact (reviewer ruling over comparator) is what counts.
        const logicalKey = id.startsWith("public_match:") ? id.slice("public_match:".length) : null;
        if (!logicalKey) return { hash: null };
        const claim = currentClaimByKey(tx, caseRow.id, logicalKey);
        if (!claim) return { hash: null };
        const match = loadPublicMatch(tx, caseRow.id, { logicalKey, contentHash: claim.contentHash });
        return { hash: match.effectiveRow?.contentHash ?? null };
      }
      case "policy_version": {
        if (!caseRow.activePolicyVersionId) return { hash: null };
        const policy = loadPolicy(tx, caseRow.activePolicyVersionId);
        return { hash: policy?.version.bundleHash ?? null, label: policy?.version.label };
      }
      case "document": {
        const doc = tx.select().from(documents).where(eq(documents.id, id)).get();
        return { hash: doc ? currentDocumentHash(doc) : null };
      }
      case "brief": {
        const brief = tx.select().from(briefs).where(eq(briefs.id, id)).get();
        return { hash: brief?.contentHash ?? null };
      }
      case "decision": {
        const decision = tx.select().from(decisions).where(eq(decisions.id, id)).get();
        if (!decision || decision.stale) return { hash: null };
        const latest = latestDecision(tx, decision.findingId);
        return { hash: latest?.id === decision.id ? decision.evidenceHash : null };
      }
    }
  };
}

export function recordDependencies(tx: DbOrTx, caseId: string, dependentType: DependentType, dependentId: string, edges: readonly LabeledEdge[]): string {
  for (const edge of edges) {
    tx.insert(dependencies)
      .values({ id: newId("dep"), caseId, dependentType, dependentId, sourceType: edge.sourceType, sourceId: edge.sourceId, sourceHash: edge.sourceHash, sourceLabel: edge.sourceLabel })
      .run();
  }
  return evidenceHash([...edges]);
}

/**
 * What a decision on a finding rests on (§12.2): the finding's claim, every
 * turn the claim quotes, the public-match fact when a rule reads it, the
 * policy version, and the compared documents.
 */
export function edgesForFinding(tx: DbOrTx, caseRow: CaseRow, finding: FindingRow, policy: LoadedPolicy | null): LabeledEdge[] {
  const edges: LabeledEdge[] = [];
  if (policy?.version.bundleHash) {
    edges.push({ sourceType: "policy_version", sourceId: policy.version.id, sourceHash: policy.version.bundleHash, sourceLabel: policy.version.label });
  }
  if (!finding.claimLogicalKey) return edges;
  const row = currentClaimByKey(tx, caseRow.id, finding.claimLogicalKey);
  if (!row) return edges;
  const [claim] = hydrateClaims(tx, [row]);
  edges.push({ sourceType: "claim", sourceId: row.logicalKey, sourceHash: row.contentHash, sourceLabel: claimLabel(claim) });
  const seenTurns = new Set<string>();
  for (const quote of claim.quotes) {
    if (seenTurns.has(quote.turnId)) continue;
    seenTurns.add(quote.turnId);
    edges.push({ sourceType: "turn", sourceId: quote.turnId, sourceHash: quote.turnTextHash, sourceLabel: quote.turnLabel });
  }
  const usesPublicMatch = policy ? [...policy.rules.values()].some((r) => collectPredicates(r.guard).some((u) => u.name === "public_match_verified")) : false;
  const match = loadPublicMatch(tx, caseRow.id, { logicalKey: row.logicalKey, contentHash: row.contentHash });
  if (usesPublicMatch && match.effectiveRow) {
    edges.push({ sourceType: "context_fact", sourceId: publicMatchKey(row.logicalKey), sourceHash: match.effectiveRow.contentHash, sourceLabel: `public evidence for ${row.logicalKey}` });
  }
  const docIds = [...new Set((match.comparison?.candidates ?? []).map((c) => c.documentId))];
  if (docIds.length > 0) {
    for (const doc of tx.select().from(documents).where(inArray(documents.id, docIds)).all()) {
      edges.push({ sourceType: "document", sourceId: doc.id, sourceHash: currentDocumentHash(doc), sourceLabel: doc.title });
    }
  }
  return edges;
}

export interface StaleOutcome {
  dependentType: DependentType;
  dependentId: string;
  label: string;
  reason: string;
}

/**
 * Marks every dependent whose evidence changed as stale and reopens what
 * follows from it: decision → finding REOPENED → REVIEW_REQUIRED; approval →
 * brief STALE and case STALE. Runs to a fixpoint because an approval depends
 * on decisions that this same pass may have just invalidated.
 */
export function runStalenessPass(tx: DbOrTx, caseId: string, actorId: string): StaleOutcome[] {
  const outcomes: StaleOutcome[] = [];
  for (let round = 0; round < 4; round++) {
    const caseRow = getCase(tx, caseId);
    const live = liveDependencies(tx, caseId);
    const stale = findStale(live, makeResolver(tx, caseRow));
    if (stale.length === 0) break;
    for (const dependent of stale) outcomes.push(markStale(tx, caseId, dependent, actorId));
  }
  return outcomes;
}

function liveDependencies(tx: DbOrTx, caseId: string): DependencyRow[] {
  const rows = tx.select().from(dependencies).where(eq(dependencies.caseId, caseId)).all();
  if (rows.length === 0) return [];
  const liveDecisions = new Set(tx.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.stale, false))).all().map((r) => r.id));
  const liveAttestations = new Set(tx.select({ id: attestations.id }).from(attestations).where(and(eq(attestations.caseId, caseId), eq(attestations.stale, false))).all().map((r) => r.id));
  const caseBriefIds = tx.select({ id: briefs.id }).from(briefs).where(eq(briefs.caseId, caseId)).all().map((r) => r.id);
  const liveApprovals = new Set(
    caseBriefIds.length > 0 ? tx.select({ id: approvals.id }).from(approvals).where(and(inArray(approvals.briefId, caseBriefIds), eq(approvals.stale, false))).all().map((r) => r.id) : [],
  );
  return rows
    .filter((r) => (r.dependentType === "decision" && liveDecisions.has(r.dependentId)) || (r.dependentType === "attestation" && liveAttestations.has(r.dependentId)) || (r.dependentType === "approval" && liveApprovals.has(r.dependentId)))
    .map((r) => ({ dependentType: r.dependentType, dependentId: r.dependentId, sourceType: r.sourceType, sourceId: r.sourceId, sourceHash: r.sourceHash, sourceLabel: r.sourceLabel }));
}

function markStale(tx: DbOrTx, caseId: string, dependent: StaleDependent, actorId: string): StaleOutcome {
  const reason = describeStaleReasons(dependent.reasons);
  const auditReasons = dependent.reasons.map((r) => ({ source: r.sourceType, id: r.sourceId, label: r.sourceLabel, old_hash: r.oldHash, new_hash: r.newHash }));
  let label = dependent.dependentId;

  if (dependent.dependentType === "decision") {
    const decision = tx.select().from(decisions).where(eq(decisions.id, dependent.dependentId)).get()!;
    tx.update(decisions).set({ stale: true, staleReason: reason }).where(eq(decisions.id, decision.id)).run();
    const finding = tx.select().from(findings).where(eq(findings.id, decision.findingId)).get()!;
    label = `decision on ${findingLabel(finding)}`;
    appendAudit(tx, { actorId, type: "STALE_DEPENDENCY", entityType: "decision", entityId: decision.id, caseId, payload: { dependent: label, reason, sources: auditReasons } });
    // DISPOSITIONED → REOPENED → REVIEW_REQUIRED: a person has to decide again.
    const reopened = applyFindingEvent(tx, finding, { type: "DEPENDENCY_CHANGED" }, SYSTEM_GUARD, { actorId, cause: `stale decision: ${reason}` });
    const back = applyFindingEvent(tx, reopened.finding, { type: "REEVALUATED" }, SYSTEM_GUARD, { actorId, cause: "re-evaluated after evidence change" });
    if (back.finding.state === "REVIEW_REQUIRED") {
      openTask(tx, {
        caseId,
        findingId: finding.id,
        kind: "review",
        question: `Evidence changed since the decision (${reason}). Review ${findingLabel(finding)} again.`,
        assignedRole: "reviewer",
        dedupeKey: `reopen-review:${decision.id}`,
        meta: { reopenedFromDecision: decision.id },
        actorId,
      });
      if (decision.kind === "escalation_decision") {
        // The original decision needed a senior reviewer; so does the new one.
        openTask(tx, {
          caseId,
          findingId: finding.id,
          kind: "escalation",
          question: `${findingLabel(finding)} was decided by a senior compliance officer; the re-decision needs one too.`,
          assignedRole: "senior_reviewer",
          dedupeKey: `reopen-escalation:${decision.id}`,
          meta: { reopenedFromDecision: decision.id },
          actorId,
        });
      }
    }
  } else if (dependent.dependentType === "attestation") {
    tx.update(attestations).set({ stale: true, staleReason: reason }).where(eq(attestations.id, dependent.dependentId)).run();
    label = "whole-call attestation";
    appendAudit(tx, { actorId, type: "STALE_DEPENDENCY", entityType: "attestation", entityId: dependent.dependentId, caseId, payload: { dependent: label, reason, sources: auditReasons } });
  } else if (dependent.dependentType === "approval") {
    const approval = tx.select().from(approvals).where(eq(approvals.id, dependent.dependentId)).get()!;
    tx.update(approvals).set({ stale: true, staleReason: reason }).where(eq(approvals.id, approval.id)).run();
    const brief = tx.select().from(briefs).where(eq(briefs.id, approval.briefId)).get()!;
    label = `approval of brief v${brief.versionNo}`;
    appendAudit(tx, { actorId, type: "STALE_DEPENDENCY", entityType: "approval", entityId: approval.id, caseId, payload: { dependent: label, reason, sources: auditReasons } });
    const next = transitionBrief(brief.status, "DEPENDENCY_CHANGED");
    if (next.ok && next.changed) {
      tx.update(briefs).set({ status: next.next, staleReason: reason, version: brief.version + 1 }).where(eq(briefs.id, brief.id)).run();
      appendAudit(tx, { actorId, type: "BRIEF_STALE", entityType: "brief", entityId: brief.id, caseId, payload: { version: brief.versionNo, from: brief.status, reason } });
    }
    applyCaseEvent(tx, getCase(tx, caseId), "EVIDENCE_CHANGED", { actorId, cause: `approval stale: ${reason}` });
  }
  return { dependentType: dependent.dependentType, dependentId: dependent.dependentId, label, reason };
}
