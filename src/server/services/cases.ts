/** Case intake (scope item 1): research questions, expert profile, and the packet. */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hashOf } from "@/core/deps/hash";
import { type Actor, isReviewer, requireRole } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { cases, documentSets, documents, experts, findings, jobs, packets, releases, reviewSessions, tasks, transcriptVersions } from "../db/schema";
import { newId } from "../ids";
import { activePolicyVersion, currentTranscript } from "./loaders";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const Quarter = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const CreateCaseSchema = z.strictObject({
  title: z.string().trim().min(3),
  issuer: z.string().trim().min(2),
  ticker: z.string().trim().min(1).max(10),
  aliases: z.array(z.string().trim().min(1)).default([]),
  issuer_fiscal: z.strictObject({
    fiscal_year_end_month: z.number().int().min(1).max(12),
    fiscal_quarters_note: z.string().optional(),
    last_reported: z.strictObject({ fy: z.number().int().min(1990).max(2100), q: Quarter, reported_on: IsoDate }),
    next_report_expected: IsoDate.nullable().default(null),
  }),
  call_date: IsoDate,
  research_questions: z.array(z.string().trim().min(3)).min(1, "add at least one research question"),
  analyst_notes: z.string().default(""),
  expert: z.strictObject({
    name: z.string().trim().min(2),
    current_employer: z.string().default(""),
    current_title: z.string().default(""),
    employment: z.array(z.strictObject({ employer: z.string().trim().min(1), title: z.string().default(""), start: IsoDate.nullable(), end: IsoDate.nullable() })).default([]),
    network: z.string().default(""),
    network_attestation: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type CreateCaseInput = z.infer<typeof CreateCaseSchema>;

export const DEFAULT_DOCUMENT_SET_ID = "docset_default";

/** Pins the curated documents into a set whose hash changes when any body changes. */
export function ensureDefaultDocumentSet(tx: DbOrTx): string {
  const docs = tx.select({ id: documents.id, bodyHash: documents.bodyHash }).from(documents).orderBy(asc(documents.id)).all();
  const hash = hashOf(docs.map((d) => [d.id, d.bodyHash]));
  const idsJson = toJson(docs.map((d) => d.id));
  const existing = tx.select().from(documentSets).where(eq(documentSets.id, DEFAULT_DOCUMENT_SET_ID)).get();
  if (!existing) tx.insert(documentSets).values({ id: DEFAULT_DOCUMENT_SET_ID, hash, documentIdsJson: idsJson }).run();
  else if (existing.hash !== hash) tx.update(documentSets).set({ hash, documentIdsJson: idsJson }).where(eq(documentSets.id, DEFAULT_DOCUMENT_SET_ID)).run();
  return DEFAULT_DOCUMENT_SET_ID;
}

export function createCase(tx: DbOrTx, input: CreateCaseInput, actor: Actor, options: { id?: string } = {}): { caseId: string; packetId: string; expertId: string } {
  requireRole(actor, "analyst");
  const now = nowIso();
  const expertId = newId("exp");
  const expertContent = { name: input.expert.name, current_employer: input.expert.current_employer, current_title: input.expert.current_title, employment: input.expert.employment, network: input.expert.network, network_attestation: input.expert.network_attestation };
  tx.insert(experts)
    .values({
      id: expertId,
      name: input.expert.name,
      currentEmployer: input.expert.current_employer,
      currentTitle: input.expert.current_title,
      employmentJson: toJson(input.expert.employment),
      network: input.expert.network,
      networkAttestationJson: toJson(input.expert.network_attestation),
      contentHash: hashOf(expertContent),
    })
    .run();

  const caseId = options.id ?? newId("case");
  tx.insert(cases)
    .values({ id: caseId, title: input.title, issuer: input.issuer, ticker: input.ticker, status: "INTAKE", createdBy: actor.id, createdAt: now, activePolicyVersionId: activePolicyVersion(tx)?.id ?? null, documentSetId: ensureDefaultDocumentSet(tx), version: 1 })
    .run();

  const packetId = newId("pkt");
  const packetContent = { research_questions: input.research_questions, aliases: input.aliases, issuer_fiscal: input.issuer_fiscal, call_date: input.call_date, analyst_notes: input.analyst_notes, expert: expertContent };
  tx.insert(packets)
    .values({
      id: packetId,
      caseId,
      versionNo: 1,
      researchQuestionsJson: toJson(input.research_questions),
      aliasesJson: toJson(input.aliases),
      issuerFiscalJson: toJson(input.issuer_fiscal),
      callDate: input.call_date,
      expertId,
      analystNotes: input.analyst_notes,
      contentHash: hashOf(packetContent),
      createdAt: now,
    })
    .run();

  appendAudit(tx, { actorId: actor.id, type: "CASE_CREATED", entityType: "case", entityId: caseId, caseId, payload: { title: input.title, issuer: input.issuer, ticker: input.ticker, call_date: input.call_date, expert: input.expert.name, research_questions: input.research_questions.length } });
  return { caseId, packetId, expertId };
}

export interface CaseListItem {
  id: string;
  title: string;
  issuer: string;
  ticker: string;
  status: string;
  expertName: string;
  callDate: string;
  transcriptVersion: number | null;
  /** Open findings by state. Null for analysts, who may never read findings (§14). */
  findingCounts: Record<string, number> | null;
  reviewMinutes: number | null;
  createdAt: string;
}

export function listCases(db: DbOrTx, actor: Actor): CaseListItem[] {
  const rows = db.select().from(cases).orderBy(desc(cases.createdAt)).all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const packetRows = db.select().from(packets).where(inArray(packets.caseId, ids)).orderBy(desc(packets.versionNo)).all();
  const expertRows = db.select().from(experts).all();
  const findingRows = isReviewer(actor) ? db.select().from(findings).where(inArray(findings.caseId, ids)).all() : [];
  const sessions = db.select().from(reviewSessions).where(inArray(reviewSessions.caseId, ids)).all();

  return rows.map((c) => {
    const packet = packetRows.find((p) => p.caseId === c.id);
    const expert = expertRows.find((e) => e.id === packet?.expertId);
    const counts: Record<string, number> = {};
    for (const f of findingRows.filter((f) => f.caseId === c.id)) counts[f.state] = (counts[f.state] ?? 0) + 1;
    const activeMs = sessions.filter((s) => s.caseId === c.id && s.mode === "blink").reduce((n, s) => n + s.activeMs, 0);
    return {
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      ticker: c.ticker,
      status: c.status,
      expertName: expert?.name ?? "—",
      callDate: packet?.callDate ?? "",
      transcriptVersion: currentTranscript(db, c.id)?.versionNo ?? null,
      findingCounts: isReviewer(actor) ? counts : null,
      reviewMinutes: isReviewer(actor) && activeMs > 0 ? Math.round((activeMs / 60000) * 10) / 10 : null,
      createdAt: c.createdAt,
    };
  });
}

export function packetView(db: DbOrTx, caseId: string) {
  const packet = db.select().from(packets).where(eq(packets.caseId, caseId)).orderBy(desc(packets.versionNo)).limit(1).get();
  if (!packet) return null;
  const expert = db.select().from(experts).where(eq(experts.id, packet.expertId)).get();
  return {
    id: packet.id,
    versionNo: packet.versionNo,
    callDate: packet.callDate,
    researchQuestions: fromJson<string[]>(packet.researchQuestionsJson, []),
    aliases: fromJson<string[]>(packet.aliasesJson, []),
    issuerFiscal: fromJson<Record<string, unknown>>(packet.issuerFiscalJson, {}),
    analystNotes: packet.analystNotes,
    contentHash: packet.contentHash,
    expert: expert
      ? { id: expert.id, name: expert.name, currentEmployer: expert.currentEmployer, currentTitle: expert.currentTitle, employment: fromJson<{ employer: string; title: string; start: string | null; end: string | null }[]>(expert.employmentJson, []), network: expert.network, networkAttestation: fromJson<Record<string, unknown>>(expert.networkAttestationJson, {}) }
      : null,
  };
}

/** The three cards above the queue (§15.1). Findings are counted only for reviewers. */
export function queueSummary(db: DbOrTx, actor: Actor) {
  const rows = db.select().from(cases).all();
  const inReview = rows.filter((c) => c.status === "IN_REVIEW" || c.status === "READY_FOR_APPROVAL" || c.status === "STALE").length;
  if (!isReviewer(actor)) return { inReview, avgReviewMinutes: null, awaitingEscalation: null };
  const sessions = db.select().from(reviewSessions).all().filter((s) => s.mode === "blink" && s.activeMs > 0);
  const perCase = new Map<string, number>();
  for (const s of sessions) perCase.set(s.caseId, (perCase.get(s.caseId) ?? 0) + s.activeMs);
  const totals = [...perCase.values()];
  const avgReviewMinutes = totals.length > 0 ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length / 60000) * 10) / 10 : null;
  const awaitingEscalation = db.select().from(tasks).all().filter((t) => t.kind === "escalation" && t.status === "open").length;
  return { inReview, avgReviewMinutes, awaitingEscalation };
}

/**
 * What an analyst sees of their own case: the packet, the transcript versions
 * they uploaded, and how far along the case is. Nothing about findings.
 */
export function analystCaseView(db: DbOrTx, caseId: string) {
  const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
  if (!row) return null;
  const versions = db.select().from(transcriptVersions).where(eq(transcriptVersions.caseId, caseId)).orderBy(desc(transcriptVersions.versionNo)).all();
  const job = db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "analyze_transcript"))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
    .find((j) => fromJson<{ caseId?: string }>(j.payloadJson, {}).caseId === caseId);
  return {
    case: { id: row.id, title: row.title, issuer: row.issuer, ticker: row.ticker, status: row.status, createdAt: row.createdAt },
    packet: packetView(db, caseId),
    transcripts: versions.map((v) => ({ versionNo: v.versionNo, sourceLabel: v.sourceLabel, createdAt: v.createdAt })),
    job: job ? { id: job.id, status: job.status } : null,
    released: db.select({ id: releases.id }).from(releases).where(eq(releases.caseId, caseId)).all().length > 0,
  };
}
