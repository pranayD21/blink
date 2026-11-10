/**
 * Research briefs (§12.5, §12.6, §9.4): drafted only from eligible claims,
 * approved by exact hash, and re-versioned on any edit.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type BriefSection, briefHash } from "@/core/deps/hash";
import { type Eligibility, type EligibilityFinding, citedClaimKeys, claimEligibility, enforceBriefCitations, renderBriefMarkdown, transitionBrief } from "@/core/workflow/brief";
import { type Actor, isReviewer, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { approvals, briefs, cases, dependencies, findingPassages, findings, jobs, llmCalls, releases } from "../db/schema";
import { conflict, forbidden, notFound, unprocessable, versionConflict } from "../errors";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { applyCaseEvent, computeReviewBlockers } from "./caseStatus";
import { type FindingRow, findingLabel, latestDecision } from "./findingsCore";
import { type LoadedClaim, getCase, isEvaluable, loadCurrentClaims, loadPolicy } from "./loaders";
import { type TurnPlacer, turnPlacer } from "./placement";
import { type LabeledEdge, claimLabel, recordDependencies } from "./staleness";

export type BriefRow = typeof briefs.$inferSelect;

export const AUDIENCES = ["analyst", "investment_team"] as const;
export const AUDIENCE_LABEL: Record<string, string> = { analyst: "Covering analyst", investment_team: "Investment team" };

const SectionsSchema = z.array(z.strictObject({ heading: z.string().trim().min(1), sentences: z.array(z.strictObject({ text: z.string().trim().min(1), claim_ids: z.array(z.string()) })) }));

export const DraftBriefSchema = z.strictObject({ mode: z.enum(["ai", "template"]).default("ai") });
export const EditBriefSchema = z.strictObject({ sections: SectionsSchema, expectedVersion: z.number().int() });
export const ApproveBriefSchema = z.strictObject({ briefHash: z.string().min(8), audience: z.enum(AUDIENCES), expectedVersion: z.number().int() });

export function getBrief(tx: DbOrTx, briefId: string): BriefRow {
  const row = tx.select().from(briefs).where(eq(briefs.id, briefId)).get();
  if (!row) throw notFound("brief");
  return row;
}

export function latestBrief(tx: DbOrTx, caseId: string): BriefRow | null {
  return tx.select().from(briefs).where(eq(briefs.caseId, caseId)).orderBy(desc(briefs.versionNo)).limit(1).get() ?? null;
}

// ── Eligibility (§12.5) ─────────────────────────────────────────────────────

export interface LivePassage {
  findingId: string;
  /** The turn row the passage was recorded on; it may belong to an earlier transcript version. */
  turnId: string;
  start: number;
  end: number;
}

/** A finding as the eligibility check sees it, with what the release needs to hide its passages. */
export interface CaseFinding extends EligibilityFinding {
  id: string;
  origin: FindingRow["origin"];
  /** For a `live` finding, the passages it hid; empty for every other finding. */
  passages: LivePassage[];
}

export interface CaseEligibility {
  /** `turnLabels` are the claim's quoted turns as labelled on the current transcript. */
  claims: { claim: LoadedClaim; eligibility: Eligibility; turnLabels: string[] }[];
  eligible: LoadedClaim[];
  eligibleKeys: Set<string>;
  /** Claims a reviewer restricted. The brief footer states this number, never the content. */
  withheldCount: number;
  /** Every finding on the case with its latest decision, as the check used it. */
  findings: CaseFinding[];
}

export function eligibilityForCase(tx: DbOrTx, caseId: string, placer?: TurnPlacer): CaseEligibility {
  const findingRows = tx.select().from(findings).where(eq(findings.caseId, caseId)).all();
  const liveIds = findingRows.filter((f) => f.origin === "live").map((f) => f.id);
  const passageRows = liveIds.length > 0 ? tx.select().from(findingPassages).where(inArray(findingPassages.findingId, liveIds)).all() : [];
  const loaded = loadCurrentClaims(tx, caseId).filter((c) => c.fields.speaker === "expert");
  // Live passages and claim quotes may sit on different transcript versions: compare them on the current one.
  const place = liveIds.length > 0 ? (placer ?? turnPlacer(tx, caseId, [...passageRows.map((p) => p.turnId), ...loaded.flatMap((c) => c.quotes.map((q) => q.turnId))])) : null;
  // A claim quote that cannot be placed keeps its own label (it can only restrict more). A live passage
  // that cannot be placed adds none: its old label could name an unrelated current turn, and the release
  // is refused through HIDDEN_PASSAGE_UNPLACED anyway.
  const quoteLabel = (turnId: string, start: number, end: number, own: string) => (place ? (place.place(turnId, start, end)?.[0]?.turn.label ?? own) : own);
  const passageLabels = (p: LivePassage) => (place?.place(p.turnId, p.start, p.end) ?? []).map((x) => x.turn.label);

  const forCheck: CaseFinding[] = findingRows.map((f) => {
    const decision = latestDecision(tx, f.id);
    const passages = passageRows.filter((p) => p.findingId === f.id).map((p) => ({ findingId: f.id, turnId: p.turnId, start: p.startChar, end: p.endChar }));
    return {
      id: f.id,
      origin: f.origin,
      claimLogicalKey: f.claimLogicalKey,
      label: findingLabel(f),
      state: f.state,
      decision: decision ? { outcome: decision.outcome, stale: decision.stale } : null,
      passages,
      ...(f.origin === "live" ? { turnLabels: [...new Set(passages.flatMap(passageLabels))] } : {}),
    };
  });
  const claims = loaded.map((claim) => {
    const turnLabels = [...new Set(claim.quotes.map((q) => quoteLabel(q.turnId, q.start, q.end, q.turnLabel)))];
    return { claim, turnLabels, eligibility: claimEligibility({ logicalKey: claim.row.logicalKey, status: claim.row.status, turnLabels }, forCheck) };
  });
  const eligible = claims.filter((c) => c.eligibility.eligible).map((c) => c.claim);
  return { claims, eligible, eligibleKeys: new Set(eligible.map((c) => c.row.logicalKey)), withheldCount: claims.filter((c) => !c.eligibility.eligible && c.eligibility.reason === "restricted").length, findings: forCheck };
}

// ── Drafting ────────────────────────────────────────────────────────────────

function nextBriefVersion(tx: DbOrTx, caseId: string): number {
  return (latestBrief(tx, caseId)?.versionNo ?? 0) + 1;
}

export interface SaveDraftInput {
  caseId: string;
  sections: BriefSection[];
  source: "ai" | "template" | "edit";
  actorId: string;
  llmCallId?: string | null;
  /** For a manual edit, an ineligible or missing citation is an error to fix, not something to drop silently. */
  strict?: boolean;
}

/** Stores a new brief version. Earlier unreleased versions lose their approvals: a new hash voids them (§9.4). */
export function saveBriefDraft(tx: DbOrTx, input: SaveDraftInput): BriefRow {
  const caseRow = getCase(tx, input.caseId);
  const eligibility = eligibilityForCase(tx, input.caseId);
  const checked = enforceBriefCitations(input.sections, eligibility.eligibleKeys);
  if (input.strict && checked.dropped.length > 0) {
    throw unprocessable("every sentence must cite at least one eligible claim", "BRIEF_CITATION", checked.dropped);
  }
  if (checked.sections.length === 0) throw unprocessable("the brief has no sentence that cites an eligible claim", "BRIEF_EMPTY", checked.dropped);

  const title = `${caseRow.title} — research brief`;
  const bodyMd = renderBriefMarkdown(title, checked.sections, eligibility.withheldCount);
  const versionNo = nextBriefVersion(tx, input.caseId);
  const row: BriefRow = {
    id: newId("brf"),
    caseId: input.caseId,
    versionNo,
    status: "draft",
    bodyMd,
    sentencesJson: toJson(checked.sections),
    contentHash: briefHash(bodyMd, checked.sections),
    audience: "analyst",
    draftSource: input.source,
    issuesJson: toJson(checked.dropped),
    withheldCount: eligibility.withheldCount,
    eligibleCount: eligibility.eligible.length,
    llmCallId: input.llmCallId ?? null,
    staleReason: null,
    createdBy: input.actorId,
    createdAt: nowIso(),
    version: 1,
  };

  // Void approvals of earlier versions: they were for a different hash.
  for (const previous of tx.select().from(briefs).where(eq(briefs.caseId, input.caseId)).all()) {
    const live = tx.select().from(approvals).where(and(eq(approvals.briefId, previous.id), eq(approvals.stale, false))).all();
    for (const approval of live) tx.update(approvals).set({ stale: true, staleReason: `superseded by brief v${versionNo}` }).where(eq(approvals.id, approval.id)).run();
    if (previous.status === "approved") {
      tx.update(briefs).set({ status: "stale", staleReason: `superseded by brief v${versionNo}`, version: previous.version + 1 }).where(eq(briefs.id, previous.id)).run();
      appendAudit(tx, { actorId: input.actorId, type: "BRIEF_APPROVAL_VOIDED", entityType: "brief", entityId: previous.id, caseId: input.caseId, payload: { version: previous.versionNo, reason: `superseded by brief v${versionNo}` } });
    }
  }
  tx.insert(briefs).values(row).run();
  applyCaseEvent(tx, getCase(tx, input.caseId), "APPROVAL_VOIDED", { actorId: input.actorId, cause: `brief v${versionNo} drafted` });

  // Remember what each cited claim looked like when this text was written.
  const cited = citedClaimKeys(checked.sections);
  const edges: LabeledEdge[] = eligibility.eligible.filter((c) => cited.includes(c.row.logicalKey)).map((c) => ({ sourceType: "claim", sourceId: c.row.logicalKey, sourceHash: c.row.contentHash, sourceLabel: claimLabel(c) }));
  recordDependencies(tx, input.caseId, "brief", row.id, edges);

  appendAudit(tx, { actorId: input.actorId, type: "BRIEF_DRAFTED", entityType: "brief", entityId: row.id, caseId: input.caseId, payload: { version: versionNo, source: input.source, content_hash: row.contentHash, sentences: checked.sections.reduce((n, s) => n + s.sentences.length, 0), cited_claims: cited, eligible_claims: eligibility.eligible.length, withheld: eligibility.withheldCount, dropped_sentences: checked.dropped.length } });
  return row;
}

/** A deterministic draft with no model: one cited sentence per eligible claim. Labeled "Template draft" in the UI. */
export function templateSections(tx: DbOrTx, caseId: string): BriefSection[] {
  const caseRow = getCase(tx, caseId);
  const { eligible } = eligibilityForCase(tx, caseId);
  const about = (c: LoadedClaim) => c.fields.subject_entity.kind;
  const issuer = eligible.filter((c) => about(c) === "issuer");
  const others = eligible.filter((c) => about(c) !== "issuer");
  const toSentences = (list: LoadedClaim[]) => list.map((c) => ({ text: c.fields.summary, claim_ids: [c.row.logicalKey] }));
  const sections: BriefSection[] = [];
  if (issuer.length > 0) sections.push({ heading: caseRow.issuer, sentences: toSentences(issuer) });
  if (others.length > 0) sections.push({ heading: "Industry and competitors", sentences: toSentences(others) });
  return sections;
}

function assertDraftable(tx: DbOrTx, caseId: string): void {
  const caseRow = getCase(tx, caseId);
  if (caseRow.status === "INTAKE" || caseRow.status === "ANALYZING" || caseRow.status === "ANALYSIS_FAILED") throw unprocessable(`the case is ${caseRow.status}; a brief can be drafted once it is in review`);
  if (eligibilityForCase(tx, caseId).eligible.length === 0) throw unprocessable("no claim is eligible for a brief yet. Disposition the findings first.", "BRIEF_EMPTY");
}

/** POST /api/cases/:id/briefs */
export function requestBriefDraft(tx: DbOrTx, caseId: string, mode: "ai" | "template", actor: Actor): { jobId: string | null; briefId: string | null } {
  requireReviewer(actor);
  assertDraftable(tx, caseId);
  if (mode === "template") {
    const brief = saveBriefDraft(tx, { caseId, sections: templateSections(tx, caseId), source: "template", actorId: actor.id });
    return { jobId: null, briefId: brief.id };
  }
  const job = enqueueJob(tx, "draft_brief", { caseId, requestedBy: actor.id, request: newId("drf") });
  appendAudit(tx, { actorId: actor.id, type: "BRIEF_DRAFT_REQUESTED", entityType: "case", entityId: caseId, caseId, payload: { job: job.id } });
  return { jobId: job.id, briefId: null };
}

/** PATCH /api/briefs/:id — editing text creates a new version with a new hash. */
export function editBrief(tx: DbOrTx, briefId: string, input: z.infer<typeof EditBriefSchema>, actor: Actor): BriefRow {
  requireReviewer(actor);
  const brief = getBrief(tx, briefId);
  if (brief.version !== input.expectedVersion) throw versionConflict(`brief v${brief.versionNo}`, input.expectedVersion, brief.version);
  if (latestBrief(tx, brief.caseId)?.id !== brief.id) throw conflict(`brief v${brief.versionNo} is not the latest version; edit the latest one`);
  return saveBriefDraft(tx, { caseId: brief.caseId, sections: input.sections, source: "edit", actorId: actor.id, strict: true });
}

// ── Approval ────────────────────────────────────────────────────────────────

/** Cited claims that changed after the brief text was written. */
export function outdatedCitations(tx: DbOrTx, brief: BriefRow): { claimKey: string; label: string }[] {
  const deps = tx.select().from(dependencies).where(and(eq(dependencies.dependentType, "brief"), eq(dependencies.dependentId, brief.id))).all();
  const current = new Map(loadCurrentClaims(tx, brief.caseId).map((c) => [c.row.logicalKey, c]));
  return deps
    .filter((d) => d.sourceType === "claim")
    .filter((d) => {
      const claim = current.get(d.sourceId);
      return !claim || claim.row.status === "rejected" || claim.row.contentHash !== d.sourceHash;
    })
    .map((d) => ({ claimKey: d.sourceId, label: current.get(d.sourceId) ? claimLabel(current.get(d.sourceId)!) : d.sourceLabel }));
}

export function ineligibleCitations(tx: DbOrTx, brief: BriefRow): { claimKey: string; detail: string }[] {
  const eligibility = eligibilityForCase(tx, brief.caseId);
  const byKey = new Map(eligibility.claims.map((c) => [c.claim.row.logicalKey, c.eligibility]));
  return citedClaimKeys(fromJson<BriefSection[]>(brief.sentencesJson, []))
    .map((key) => ({ key, e: byKey.get(key) }))
    .filter((x) => !x.e || !x.e.eligible)
    .map((x) => ({ claimKey: x.key, detail: x.e && !x.e.eligible ? x.e.detail : "the claim no longer exists" }));
}

/** POST /api/briefs/:id/approve — the reviewer approves this exact hash for one audience. */
export function approveBrief(tx: DbOrTx, briefId: string, input: z.infer<typeof ApproveBriefSchema>, actor: Actor): { approvalId: string; briefHash: string; evidenceHash: string } {
  requireReviewer(actor);
  const brief = getBrief(tx, briefId);
  if (brief.version !== input.expectedVersion) throw versionConflict(`brief v${brief.versionNo}`, input.expectedVersion, brief.version);
  if (latestBrief(tx, brief.caseId)?.id !== brief.id) throw conflict(`brief v${brief.versionNo} is not the latest version`);
  const next = transitionBrief(brief.status, "APPROVE");
  if (!next.ok) throw unprocessable(next.message, "BRIEF_TRANSITION");
  if (input.briefHash !== brief.contentHash) throw conflict("the hash you approved does not match this brief's content. Reload and review the current text.", "BRIEF_HASH_MISMATCH");

  const blockers = computeReviewBlockers(tx, brief.caseId);
  if (blockers.length > 0) throw unprocessable("the review is not complete, so nothing can be approved yet", "REVIEW_INCOMPLETE", blockers);
  const ineligible = ineligibleCitations(tx, brief);
  if (ineligible.length > 0) throw unprocessable("the brief cites claims that are not eligible", "CLAIM_NOT_ELIGIBLE", ineligible);
  const outdated = outdatedCitations(tx, brief);
  if (outdated.length > 0) throw unprocessable(`cited claim${outdated.length > 1 ? "s" : ""} ${outdated.map((o) => o.label).join("; ")} changed after this text was written. Redraft or edit the brief.`, "BRIEF_OUTDATED", outdated);

  const caseRow = applyCaseEvent(tx, getCase(tx, brief.caseId), "BRIEF_APPROVED", { actorId: actor.id, cause: `brief v${brief.versionNo} approved` }, { strict: true });

  // What the approval rests on (§12.2): the brief hash, each cited claim, the decisions that made them eligible, the policy version.
  const sections = fromJson<BriefSection[]>(brief.sentencesJson, []);
  const cited = new Set(citedClaimKeys(sections));
  const claims = loadCurrentClaims(tx, brief.caseId).filter((c) => cited.has(c.row.logicalKey));
  const edges: LabeledEdge[] = [{ sourceType: "brief", sourceId: brief.id, sourceHash: brief.contentHash, sourceLabel: `brief v${brief.versionNo}` }];
  for (const claim of claims) edges.push({ sourceType: "claim", sourceId: claim.row.logicalKey, sourceHash: claim.row.contentHash, sourceLabel: claimLabel(claim) });
  for (const finding of tx.select().from(findings).where(eq(findings.caseId, brief.caseId)).all()) {
    if (!finding.claimLogicalKey || !cited.has(finding.claimLogicalKey)) continue;
    const decision = latestDecision(tx, finding.id);
    if (decision) edges.push({ sourceType: "decision", sourceId: decision.id, sourceHash: decision.evidenceHash, sourceLabel: `decision on ${findingLabel(finding)}` });
  }
  const policy = caseRow.activePolicyVersionId ? loadPolicy(tx, caseRow.activePolicyVersionId) : null;
  if (policy?.version.bundleHash) edges.push({ sourceType: "policy_version", sourceId: policy.version.id, sourceHash: policy.version.bundleHash, sourceLabel: policy.version.label });

  const approvalId = newId("apr");
  const evidenceHash = recordDependencies(tx, brief.caseId, "approval", approvalId, edges);
  tx.insert(approvals).values({ id: approvalId, briefId: brief.id, actorId: actor.id, briefHash: brief.contentHash, audience: input.audience, evidenceHash, stale: false, staleReason: null, createdAt: nowIso() }).run();
  tx.update(briefs).set({ status: next.next, audience: input.audience, version: brief.version + 1 }).where(eq(briefs.id, brief.id)).run();
  appendAudit(tx, { actorId: actor.id, type: "BRIEF_APPROVED", entityType: "brief", entityId: brief.id, caseId: brief.caseId, payload: { version: brief.versionNo, brief_hash: brief.contentHash, audience: input.audience, approval: approvalId, evidence_hash: evidenceHash, cited_claims: [...cited] } });
  return { approvalId, briefHash: brief.contentHash, evidenceHash };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface CitationView {
  key: string;
  summary: string;
  quotes: { turnLabel: string; quote: string; role: string }[];
}

function citationsFor(tx: DbOrTx, caseId: string, keys: string[]): CitationView[] {
  const claims = loadCurrentClaims(tx, caseId);
  return keys.map((key) => {
    const claim = claims.find((c) => c.row.logicalKey === key);
    return { key, summary: claim?.fields.summary ?? "(claim no longer available)", quotes: (claim?.quotes ?? []).map((q) => ({ turnLabel: q.turnLabel, quote: q.quote, role: q.role })) };
  });
}

/** Everything the brief page needs. Reviewers only: an analyst may never read an unreleased brief. */
export function briefWorkspace(tx: DbOrTx, caseId: string, actor: Actor) {
  if (!isReviewer(actor)) throw forbidden("only compliance reviewers can open the brief workspace; analysts see released briefs on the Analyst page");
  const caseRow = getCase(tx, caseId);
  const rows = tx.select().from(briefs).where(eq(briefs.caseId, caseId)).orderBy(desc(briefs.versionNo)).all();
  const latest = rows[0] ?? null;
  const eligibility = eligibilityForCase(tx, caseId);
  const approvalRows = rows.length > 0 ? tx.select().from(approvals).where(inArray(approvals.briefId, rows.map((r) => r.id))).orderBy(desc(approvals.createdAt), desc(approvals.id)).all() : [];
  const releaseRows = tx.select().from(releases).where(eq(releases.caseId, caseId)).orderBy(desc(releases.releasedAt)).all();
  const sections = latest ? fromJson<BriefSection[]>(latest.sentencesJson, []) : [];
  const latestApproval = latest ? (approvalRows.find((a) => a.briefId === latest.id) ?? null) : null;
  const draftCall = latest?.llmCallId ? tx.select().from(llmCalls).where(eq(llmCalls.id, latest.llmCallId)).get() : null;

  return {
    case: { id: caseRow.id, title: caseRow.title, issuer: caseRow.issuer, status: caseRow.status, version: caseRow.version },
    brief: latest
      ? {
          id: latest.id,
          versionNo: latest.versionNo,
          status: latest.status,
          version: latest.version,
          contentHash: latest.contentHash,
          audience: latest.audience,
          draftSource: latest.draftSource,
          bodyMd: latest.bodyMd,
          sections,
          dropped: fromJson<{ heading: string; text: string; reason: string }[]>(latest.issuesJson, []),
          withheldCount: latest.withheldCount,
          staleReason: latest.staleReason,
          llmCallId: latest.llmCallId,
          replayed: draftCall?.replayed ?? false,
          recordedAt: draftCall?.recordedAt ?? null,
          createdAt: latest.createdAt,
          citations: citationsFor(tx, caseId, citedClaimKeys(sections)),
          outdated: latest.status === "draft" || latest.status === "stale" ? outdatedCitations(tx, latest) : [],
          ineligible: ineligibleCitations(tx, latest),
        }
      : null,
    approval: latestApproval ? { id: latestApproval.id, briefHash: latestApproval.briefHash, audience: latestApproval.audience, stale: latestApproval.stale, staleReason: latestApproval.staleReason, actorId: latestApproval.actorId, evidenceHash: latestApproval.evidenceHash, createdAt: latestApproval.createdAt } : null,
    versions: rows.map((r) => ({ id: r.id, versionNo: r.versionNo, status: r.status, contentHash: r.contentHash, draftSource: r.draftSource, createdAt: r.createdAt, staleReason: r.staleReason })),
    releases: releaseRows.map((r) => ({ id: r.id, briefId: r.briefId, briefHash: r.briefHash, audience: r.audience, releasedAt: r.releasedAt, actorId: r.actorId })),
    eligibility: {
      eligibleCount: eligibility.eligible.length,
      withheldCount: eligibility.withheldCount,
      claims: eligibility.claims.filter((c) => isEvaluable(c.claim) || c.claim.row.status === "rejected").map((c) => ({
        key: c.claim.row.logicalKey,
        summary: c.claim.fields.summary,
        turnLabels: c.claim.turnLabels,
        eligible: c.eligibility.eligible,
        reason: c.eligibility.eligible ? null : c.eligibility.reason,
        detail: c.eligibility.eligible ? null : c.eligibility.detail,
      })),
    },
    reviewBlockers: computeReviewBlockers(tx, caseId),
    audiences: AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABEL[a] })),
  };
}

/** GET /api/analyst/briefs — released briefs only, with the quotes behind each citation. */
export function releasedBriefs(tx: DbOrTx) {
  const releaseRows = tx.select().from(releases).orderBy(desc(releases.releasedAt)).all();
  const caseRows = new Map(tx.select().from(cases).all().map((c) => [c.id, c]));
  const newestByCase = new Map<string, string>();
  for (const r of releaseRows) if (!newestByCase.has(r.caseId)) newestByCase.set(r.caseId, r.id);

  return releaseRows.map((release) => {
    const brief = getBrief(tx, release.briefId);
    const caseRow = caseRows.get(release.caseId)!;
    const sections = fromJson<BriefSection[]>(brief.sentencesJson, []);
    const newest = newestByCase.get(release.caseId) === release.id;
    // Exposure has already occurred; the view says so rather than quietly withdrawing the brief (§9.3).
    const standing = !newest ? ("superseded" as const) : brief.status === "released" ? ("current" as const) : ("under_re_review" as const);
    return {
      releaseId: release.id,
      releasedAt: release.releasedAt,
      audience: release.audience,
      briefHash: release.briefHash,
      case: { id: caseRow.id, title: caseRow.title, issuer: caseRow.issuer, ticker: caseRow.ticker },
      versionNo: brief.versionNo,
      standing,
      staleReason: standing === "under_re_review" ? brief.staleReason : null,
      sections,
      withheldCount: brief.withheldCount,
      citations: citationsFor(tx, release.caseId, citedClaimKeys(sections)),
    };
  });
}

/** The newest brief-draft job for a case, so the page can show progress or the reason a draft failed. */
export function latestDraftJob(db: DbOrTx, caseId: string): { id: string; status: string; error: string | null; createdAt: string } | null {
  const job = db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "draft_brief"))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
    .find((j) => fromJson<{ caseId?: string }>(j.payloadJson, {}).caseId === caseId);
  return job ? { id: job.id, status: job.status, error: job.error, createdAt: job.createdAt } : null;
}
