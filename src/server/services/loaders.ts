/**
 * Row loaders shared by the services: they turn database rows into the plain
 * values the pure core works on.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { documentHash } from "@/core/deps/hash";
import type { ComparableDocument, ComparisonResult, DocFact } from "@/core/evidence/compare";
import { type Inventory, type Monitor, type PolicyParagraph, type RulesDoc, parsePolicyParagraphs } from "@/core/policy/schema";
import { type CompiledRule, compileRules } from "@/core/policy/validate";
import type { PublicMatchFact } from "@/core/predicates/registry";
import type { CaseContext, ClaimFields, ClaimQuote, ClaimRecord, Employment, ExpertProfile, IssuerFiscal, Solicited } from "@/core/types";
import { type DbOrTx, fromJson } from "../db/client";
import {
  cases,
  claimLinks,
  claimQuotes,
  claims,
  contextFacts,
  documentSets,
  documents,
  experts,
  packets,
  policySources,
  policyVersions,
  transcriptVersions,
  turns,
} from "../db/schema";
import { notFound } from "../errors";

export type CaseRow = typeof cases.$inferSelect;
export type PacketRow = typeof packets.$inferSelect;
export type ExpertRow = typeof experts.$inferSelect;
export type TranscriptRow = typeof transcriptVersions.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type ClaimQuoteRow = typeof claimQuotes.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type PolicyVersionRow = typeof policyVersions.$inferSelect;
export type ContextFactRow = typeof contextFacts.$inferSelect;

export function getCase(db: DbOrTx, caseId: string): CaseRow {
  const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!row) throw notFound("case");
  return row;
}

export function currentPacket(db: DbOrTx, caseId: string): PacketRow {
  const row = db.select().from(packets).where(eq(packets.caseId, caseId)).orderBy(desc(packets.versionNo)).limit(1).get();
  if (!row) throw notFound("case packet");
  return row;
}

export function currentTranscript(db: DbOrTx, caseId: string): TranscriptRow | null {
  return db.select().from(transcriptVersions).where(eq(transcriptVersions.caseId, caseId)).orderBy(desc(transcriptVersions.versionNo)).limit(1).get() ?? null;
}

export function turnsOfVersion(db: DbOrTx, transcriptVersionId: string): TurnRow[] {
  return db.select().from(turns).where(eq(turns.transcriptVersionId, transcriptVersionId)).orderBy(asc(turns.idx)).all();
}

export function expertProfile(row: ExpertRow): ExpertProfile {
  return {
    name: row.name,
    current_employer: row.currentEmployer,
    current_title: row.currentTitle,
    employment: fromJson<Employment[]>(row.employmentJson, []),
    network: row.network,
    network_attestation: fromJson<Record<string, unknown>>(row.networkAttestationJson, {}),
  };
}

export interface CaseBundle {
  caseRow: CaseRow;
  packet: PacketRow;
  expert: ExpertRow;
  ctx: CaseContext;
  expertProfile: ExpertProfile;
  researchQuestions: string[];
}

export function loadCaseBundle(db: DbOrTx, caseId: string): CaseBundle {
  const caseRow = getCase(db, caseId);
  const packet = currentPacket(db, caseId);
  const expert = db.select().from(experts).where(eq(experts.id, packet.expertId)).get();
  if (!expert) throw notFound("expert profile");
  const ctx: CaseContext = {
    issuer: caseRow.issuer,
    ticker: caseRow.ticker,
    aliases: fromJson<string[]>(packet.aliasesJson, []),
    fiscal: fromJson<IssuerFiscal>(packet.issuerFiscalJson, { fiscal_year_end_month: 12, last_reported: { fy: 0, q: 4, reported_on: "" }, next_report_expected: null }),
    callDate: packet.callDate,
  };
  return { caseRow, packet, expert, ctx, expertProfile: expertProfile(expert), researchQuestions: fromJson<string[]>(packet.researchQuestionsJson, []) };
}

// ── Claims ──────────────────────────────────────────────────────────────────

export interface ClaimMeta {
  solicitedByAnalyst: Solicited;
  fieldUncertainty: { field: string; kind: "ambiguous" | "conflicting_statements"; note: string }[];
  conflictFields: string[];
  ungroundedFields: string[];
  /** Questions the extraction model proposed for this claim (labeled AI-suggested in the UI). */
  aiQuestions: string[];
  /** Set when the claim's evidence disappeared from a later transcript version. */
  retiredReason?: string;
}

export const EMPTY_META: ClaimMeta = { solicitedByAnalyst: "unclear", fieldUncertainty: [], conflictFields: [], ungroundedFields: [], aiQuestions: [] };

export interface LoadedQuote extends ClaimQuote {
  id: string;
  turnId: string;
}

export interface LoadedClaim {
  row: ClaimRow;
  record: ClaimRecord;
  fields: ClaimFields;
  meta: ClaimMeta;
  quotes: LoadedQuote[];
  links: { linkedLogicalKey: string; kind: string }[];
  /** Distinct turn labels this claim quotes, in order: ["T5", "T11"]. */
  turnLabels: string[];
}

export function hydrateClaims(db: DbOrTx, rows: ClaimRow[]): LoadedClaim[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const quoteRows = db.select().from(claimQuotes).where(inArray(claimQuotes.claimId, ids)).all();
  const linkRows = db.select().from(claimLinks).where(inArray(claimLinks.claimId, ids)).all();
  const turnIds = [...new Set(quoteRows.map((q) => q.turnId))];
  const turnRows = turnIds.length > 0 ? db.select().from(turns).where(inArray(turns.id, turnIds)).all() : [];
  const turnById = new Map(turnRows.map((t) => [t.id, t]));

  return rows.map((row) => {
    const meta = { ...EMPTY_META, ...fromJson<Partial<ClaimMeta>>(row.metaJson, {}) };
    const quotes: LoadedQuote[] = quoteRows
      .filter((q) => q.claimId === row.id)
      .map((q) => {
        const turn = turnById.get(q.turnId);
        return {
          id: q.id,
          turnId: q.turnId,
          turnLabel: turn?.label ?? "?",
          turnIdx: turn?.idx ?? 0,
          turnTextHash: q.turnTextHash,
          quote: q.quote,
          start: q.startChar,
          end: q.endChar,
          role: q.role,
          supportsFields: fromJson<string[]>(q.supportsFieldsJson, []),
          normalized: q.normalized,
        };
      })
      .sort((a, b) => a.turnIdx - b.turnIdx || a.start - b.start);
    const asserted = fromJson<ClaimFields>(row.assertedJson, {} as ClaimFields);
    const verified = fromJson<Partial<ClaimFields> | null>(row.verifiedJson, null);
    const record: ClaimRecord = {
      logicalKey: row.logicalKey,
      asserted,
      verified,
      quotes,
      solicitedByAnalyst: meta.solicitedByAnalyst,
      conflictFields: meta.conflictFields,
      ungroundedFields: meta.ungroundedFields,
    };
    return {
      row,
      record,
      fields: fromJson<ClaimFields>(row.fieldsJson, asserted),
      meta,
      quotes,
      links: linkRows.filter((l) => l.claimId === row.id).map((l) => ({ linkedLogicalKey: l.linkedLogicalKey, kind: l.kind })),
      turnLabels: [...new Set(quotes.map((q) => q.turnLabel))],
    };
  });
}

/** The newest version of every claim on the case, including rejected ones. */
export function loadCurrentClaims(db: DbOrTx, caseId: string): LoadedClaim[] {
  const rows = db.select().from(claims).where(and(eq(claims.caseId, caseId), isNull(claims.supersededBy))).orderBy(asc(claims.createdAt), asc(claims.id)).all();
  const sorted = [...rows].sort((a, b) => keyOrder(a.logicalKey) - keyOrder(b.logicalKey) || (a.logicalKey < b.logicalKey ? -1 : 1));
  return hydrateClaims(db, sorted);
}

/** "C10" sorts after "C9". */
function keyOrder(key: string): number {
  const n = Number(/\d+/.exec(key)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function currentClaimByKey(db: DbOrTx, caseId: string, logicalKey: string): ClaimRow | null {
  return db.select().from(claims).where(and(eq(claims.caseId, caseId), eq(claims.logicalKey, logicalKey), isNull(claims.supersededBy))).get() ?? null;
}

/** Claims that take part in policy evaluation: the expert's, and not rejected. */
export const isEvaluable = (c: LoadedClaim) => c.row.status !== "rejected" && c.fields.speaker === "expert";

// ── Public-match context facts ──────────────────────────────────────────────

export const publicMatchKey = (logicalKey: string) => `public_match:${logicalKey}`;

export interface PublicMatchState {
  /** What `public_match_verified` reads. */
  fact: PublicMatchFact | null;
  /** The row behind `fact` (a reviewer ruling wins over the comparator). */
  effectiveRow: ContextFactRow | null;
  comparison: ComparisonResult | null;
  comparisonRow: ContextFactRow | null;
  reviewer: { verdict: "verified" | "rejected"; note: string; actorId: string; at: string; documentId: string | null; factId: string | null } | null;
}

interface ReviewerMatchValue {
  verdict: "verified" | "rejected";
  note: string;
  actorId: string;
  documentId: string | null;
  factId: string | null;
  /** The claim content this ruling was made on; a changed claim voids it. */
  claimHash: string;
}

export function loadPublicMatch(db: DbOrTx, caseId: string, claim: { logicalKey: string; contentHash: string }): PublicMatchState {
  const rows = db
    .select()
    .from(contextFacts)
    .where(and(eq(contextFacts.caseId, caseId), eq(contextFacts.key, publicMatchKey(claim.logicalKey)), isNull(contextFacts.supersededBy)))
    .orderBy(desc(contextFacts.createdAt), desc(contextFacts.id))
    .all();
  const comparisonRow = rows.find((r) => r.source === "comparison") ?? null;
  const reviewerRow = rows.find((r) => r.source === "reviewer") ?? null;
  const comparison = comparisonRow ? fromJson<ComparisonResult | null>(comparisonRow.valueJson, null) : null;

  const reviewerValue = reviewerRow ? fromJson<ReviewerMatchValue | null>(reviewerRow.valueJson, null) : null;
  if (reviewerRow && reviewerValue && reviewerValue.claimHash === claim.contentHash) {
    const verified = reviewerValue.verdict === "verified";
    return {
      fact: {
        state: verified ? "supported" : "refuted",
        outcome: verified ? "reviewer_verified" : "reviewer_rejected",
        method: "reviewer",
        searchedDocuments: comparison?.searchedDocuments ?? 0,
        summary: verified ? `A reviewer verified a public source${reviewerValue.note ? `: ${reviewerValue.note}` : ""}` : `A reviewer rejected the proposed public match${reviewerValue.note ? `: ${reviewerValue.note}` : ""}`,
      },
      effectiveRow: reviewerRow,
      comparison,
      comparisonRow,
      reviewer: { verdict: reviewerValue.verdict, note: reviewerValue.note, actorId: reviewerValue.actorId, at: reviewerRow.createdAt, documentId: reviewerValue.documentId, factId: reviewerValue.factId },
    };
  }
  if (comparisonRow && comparison) {
    return {
      fact: { state: comparison.state, outcome: comparison.outcome, method: "comparator", searchedDocuments: comparison.searchedDocuments, summary: comparison.summary },
      effectiveRow: comparisonRow,
      comparison,
      comparisonRow,
      reviewer: null,
    };
  }
  return { fact: null, effectiveRow: null, comparison: null, comparisonRow: null, reviewer: null };
}

// ── Documents ───────────────────────────────────────────────────────────────

export function documentFacts(row: DocumentRow): DocFact[] {
  return fromJson<DocFact[]>(row.factsJson, []);
}

export function currentDocumentHash(row: DocumentRow): string {
  return documentHash(row.bodyHash, documentFacts(row).filter((f) => f.verified).map((f) => f.fact_id));
}

export function loadDocumentSet(db: DbOrTx, documentSetId: string | null): { rows: DocumentRow[]; comparable: ComparableDocument[] } {
  if (!documentSetId) return { rows: [], comparable: [] };
  const set = db.select().from(documentSets).where(eq(documentSets.id, documentSetId)).get();
  const ids = set ? fromJson<string[]>(set.documentIdsJson, []) : [];
  const rows = ids.length > 0 ? db.select().from(documents).where(inArray(documents.id, ids)).orderBy(asc(documents.publishedAt), asc(documents.id)).all() : [];
  return {
    rows,
    comparable: rows.map((d) => ({
      id: d.id,
      title: d.title,
      issuer: d.issuer,
      relatedIssuers: fromJson<string[]>(d.relatedIssuersJson, []),
      publishedAt: d.publishedAt,
      sourceType: d.sourceType,
      facts: documentFacts(d),
    })),
  };
}

// ── Policy ──────────────────────────────────────────────────────────────────

export interface LoadedPolicy {
  version: PolicyVersionRow;
  sourceText: string;
  title: string;
  paragraphs: PolicyParagraph[];
  inventory: Inventory | null;
  rulesDoc: RulesDoc;
  monitors: Monitor[];
  rules: Map<string, CompiledRule>;
}

export function getPolicyVersion(db: DbOrTx, id: string): PolicyVersionRow {
  const row = db.select().from(policyVersions).where(eq(policyVersions.id, id)).get();
  if (!row) throw notFound("policy version");
  return row;
}

export function activePolicyVersion(db: DbOrTx): PolicyVersionRow | null {
  return db.select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE")).orderBy(desc(policyVersions.activatedAt)).limit(1).get() ?? null;
}

/** Loads a policy version's compiled rules and monitors for runtime use. Returns null if it never compiled. */
export function loadPolicy(db: DbOrTx, policyVersionId: string): LoadedPolicy | null {
  const version = db.select().from(policyVersions).where(eq(policyVersions.id, policyVersionId)).get();
  if (!version) return null;
  const rulesDoc = fromJson<RulesDoc | null>(version.rulesJson, null);
  const monitors = fromJson<{ monitors: Monitor[] } | null>(version.monitorsJson, null)?.monitors;
  if (!rulesDoc || !monitors) return null;
  const source = db.select().from(policySources).where(eq(policySources.id, version.policySourceId)).get();
  let rules: Map<string, CompiledRule>;
  try {
    rules = compileRules(rulesDoc);
  } catch {
    return null;
  }
  return {
    version,
    sourceText: source?.text ?? "",
    title: source?.title ?? version.label,
    paragraphs: parsePolicyParagraphs(source?.text ?? ""),
    inventory: fromJson<Inventory | null>(version.inventoryJson, null),
    rulesDoc,
    monitors,
    rules,
  };
}
