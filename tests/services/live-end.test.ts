/**
 * Ending a live call: the turns become transcript v1, the after-call read is queued, and every
 * live flag the after-call read does not confirm is kept as a finding for compliance. The live
 * reader is a test double and the after-call read uses the hand-labeled claims, so nothing here
 * touches the network.
 */
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnHash } from "@/core/deps/hash";
import { type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, LlmExtractionSchema } from "@/core/extraction/schema";
import { endedText } from "@/core/live/pill";
import type { LiveTurn } from "@/core/live/transcript";
import { EVIDENCE_FIELDS } from "@/core/types";
import { listAudit } from "@/server/audit/log";
import { setClockForTests } from "@/server/clock";
import { fromJson, getDb, resetDbForTests, transact } from "@/server/db/client";
import { callClaims, callOutages, callTurns, calls, claimQuotes, findingPassages, jobs, processingIssues } from "@/server/db/schema";
import { drainJobs } from "@/server/jobs/runner";
import type { LiveReader } from "@/server/live/reader";
import { type CallRow, ackTurn, endCall, ingestTurn, recordOutage, reconcileLiveFlags, startCall } from "@/server/services/live";
import { turnsOfVersion } from "@/server/services/loaders";
import { seedDatabase } from "@/server/services/seed";
import { CASE, answerMarginClarification, appError, findingOn, findingsOf, openTasks, statusOf, user } from "../helpers/db";
import { readJson } from "../helpers/fixtures";
import { goldReader, halvorsenLiveTurns, scriptedReader } from "../helpers/live";

const CALL_START = Date.parse("2026-11-10T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

let call: CallRow;

const priya = () => user("priya");
const halvorsen = halvorsenLiveTurns();
const asInput = (t: LiveTurn) => ({ ...t, speechEndedAt: iso(CALL_START + t.speechEndMs), transcribedAt: iso(CALL_START + t.speechEndMs + 200) });
const post = (seq: number, reader: LiveReader = goldReader()) => ingestTurn(call.id, asInput(halvorsen[seq - 1]), priya(), { reader });

async function feed(n: number, reader: LiveReader = goldReader()): Promise<void> {
  for (let seq = 1; seq <= n; seq++) await post(seq, reader);
}

const end = (options?: { source?: "ai" | "gold" }) => transact((tx) => endCall(tx, call.id, priya(), options));
const callRow = () => getDb().select().from(calls).where(eq(calls.id, call.id)).get()!;
const claimRows = () => getDb().select().from(callClaims).where(eq(callClaims.callId, call.id)).all();
const turnRow = (seq: number) => getDb().select().from(callTurns).where(and(eq(callTurns.callId, call.id), eq(callTurns.seq, seq))).get()!;
const passagesOf = (findingId: string) => getDb().select().from(findingPassages).where(eq(findingPassages.findingId, findingId)).all();
const issuesOf = (code: string) => getDb().select().from(processingIssues).where(and(eq(processingIssues.caseId, CASE), eq(processingIssues.code, code))).all();
const liveFindings = () => findingsOf().filter((f) => f.origin === "live");

/**
 * The gold C1 (dashboard bookings) said in T7 instead: every field it asserts rests on one quote
 * of T7, so the rules meet R1 there. The hand-labeled after-call read has no finding on T7.
 */
function dashboardClaimAtT7(): LiveReader {
  const gold = LlmExtractionSchema.parse(readJson<{ extraction: unknown }>("cases", "halvorsen", "gold.json").extraction);
  const c1 = gold.claims.find((c) => c.logical_key === "C1")!;
  const claim: LlmExtraction["claims"][number] = { ...c1, quotes: [{ turn_id: "T7", quote: "Distributors broadly are soft right now.", role: "primary", supports_fields: [...EVIDENCE_FIELDS] }] };
  const turns: GroundingTurn[] = halvorsen.slice(0, 7).map((t) => ({ label: `T${t.seq}`, idx: t.seq, speaker: t.speaker, text: t.text, textHash: turnHash(t.text) }));
  const grounded = groundExtraction({ claims: [claim], suggested_concerns: [], missing_context_questions: [], call_summary: "" }, turns);
  return scriptedReader({ T7: { claims: grounded.claims } });
}

beforeEach(async () => {
  resetDbForTests();
  await seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true });
  call = transact((tx) => startCall(tx, { caseId: CASE }, priya()));
});

afterEach(() => setClockForTests(null));

describe("ending a call", () => {
  it("ending uploads the turns as transcript v1, queues the after-call read, and counts what was flagged", async () => {
    await feed(22);
    const r = end();
    expect(r.pillText).toBe(endedText(r.hiddenCount));
    expect(r.hiddenCount).toBeGreaterThanOrEqual(1);
    expect(r.hiddenCount).toBe(claimRows().filter((c) => c.flagged !== "none").length);
    expect(r.jobId).not.toBeNull();
    const turns = turnsOfVersion(getDb(), r.transcriptVersionId!);
    expect(turns.map((t) => t.label).at(-1)).toBe("T22");
    expect(turns.map((t) => t.text)).toEqual(halvorsen.map((t) => t.text));
    expect(turns.find((t) => t.label === "T2")).toMatchObject({ speaker: "analyst", speakerName: priya().name });

    expect(callRow()).toMatchObject({ status: "ended", transcriptVersionId: r.transcriptVersionId, analysisJobId: r.jobId, hiddenCount: r.hiddenCount });
    expect(callRow().endedAt).not.toBeNull();
    const job = getDb().select().from(jobs).where(eq(jobs.id, r.jobId!)).get()!;
    expect(fromJson<{ source: string }>(job.payloadJson, { source: "" }).source).toBe("ai");
    expect(listAudit(getDb(), CASE).filter((e) => e.type === "CALL_ENDED")).toHaveLength(1);

    // An ended call takes no more turns and cannot be ended again.
    expect(appError(() => end())).toMatchObject({ status: 409, code: "CALL_NOT_LIVE" });
    const late = { seq: 23, speaker: "expert" as const, text: "One more thing.", speechStartMs: 400_000, speechEndMs: 401_000, speechEndedAt: iso(CALL_START + 401_000), transcribedAt: iso(CALL_START + 401_200) };
    await expect(ingestTurn(call.id, late, priya(), { reader: goldReader() })).rejects.toMatchObject({ status: 409, code: "CALL_NOT_LIVE" });
  });

  it("a flag the after-call read also raises opens no second finding", async () => {
    await feed(22);
    const r = end({ source: "gold" });
    await drainJobs(); // the hand-labeled claims stand in for the after-call read, so no network is needed
    expect(claimRows().filter((c) => c.flagged !== "none").length).toBeGreaterThanOrEqual(1);
    expect(findingsOf().filter((f) => f.origin === "policy").length).toBeGreaterThanOrEqual(1);
    expect(liveFindings()).toEqual([]);
    expect(transact((tx) => reconcileLiveFlags(tx, r.transcriptVersionId!))).toEqual({ created: [] });
  });

  it("a flag the after-call read misses becomes a finding with its passage, and stays for compliance", async () => {
    await feed(22, dashboardClaimAtT7());
    expect(claimRows().map((c) => c.flagged)).toEqual(["review_required"]);
    const r = end({ source: "gold" });
    expect(r.hiddenCount).toBe(1);
    expect(r.pillText).toBe("Call ended. 1 passage hidden and sent to compliance.");
    await drainJobs();

    const live = liveFindings();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ state: "REVIEW_REQUIRED", title: "Flagged during the call", severity: "high", claimLogicalKey: null, createdBy: "system" });
    expect(live[0].dedupeKey).toBe(`live:${CASE}:${claimRows()[0].id}`);
    const ruleIds = fromJson<string[]>(claimRows()[0].ruleIdsJson, []);
    expect(ruleIds).toContain("R1");
    expect(fromJson<string[]>(live[0].reasonCodesJson, [])).toEqual(["LIVE_ONLY", ...ruleIds, "TURN:T7"]);
    expect(live[0].explanation).toMatch(/T7/);
    expect(live[0].explanation).toMatch(/: it met rule R1(, rule R\d+)*( and rule R\d+)? during the call\. The after-call read raised no policy finding on this turn, so it stays hidden/);
    // The passage is the whole turn, and none of its words are in the explanation.
    const passages = passagesOf(live[0].id);
    expect(passages.map((p) => p.turnId.split(":").at(-1))).toEqual(["T7"]);
    const t7 = turnsOfVersion(getDb(), r.transcriptVersionId!).find((t) => t.label === "T7")!;
    expect(passages[0]).toMatchObject({ turnId: t7.id, startChar: 0, endChar: t7.text.length });
    expect(live[0].explanation).not.toContain("Distributors");
    expect(openTasks(live[0].id, "review")).toHaveLength(1);
    expect(statusOf()).toBe("IN_REVIEW");

    // Reconciling again opens nothing new.
    expect(transact((tx) => reconcileLiveFlags(tx, r.transcriptVersionId!))).toEqual({ created: [] });
    expect(passagesOf(live[0].id)).toHaveLength(1);
  });

  it("a policy finding that is no longer held for compliance does not cover a live flag", async () => {
    await feed(22);
    const r = end({ source: "gold" });
    await drainJobs();
    expect(liveFindings()).toEqual([]);
    // The margin finding (C8, T17) is answered as public commentary: not triggered, awaiting acknowledgement.
    answerMarginClarification();
    expect(findingOn("C8").state).toBe("NOT_TRIGGERED_PENDING_ACK");

    const { created } = transact((tx) => reconcileLiveFlags(tx, r.transcriptVersionId!));
    expect(created).toHaveLength(1);
    const live = liveFindings();
    expect(live.map((f) => f.id)).toEqual(created);
    expect(live[0].dedupeKey).toBe(`live:${CASE}:${call.id}:C8`);
    expect(passagesOf(live[0].id).map((p) => p.turnId.split(":").at(-1))).toEqual(["T17"]);
  });

  it("coverage is per turn: a turn the after-call finding does not quote still gets a live finding", async () => {
    await feed(22);
    const r = end({ source: "gold" });
    await drainJobs();
    expect(liveFindings()).toEqual([]);
    // As if the after-call read had confirmed C1 on T5 only: drop its quotes of T11.
    const t11 = `${r.transcriptVersionId}:T11`;
    getDb().delete(claimQuotes).where(eq(claimQuotes.turnId, t11)).run();

    transact((tx) => reconcileLiveFlags(tx, r.transcriptVersionId!));
    const live = liveFindings();
    expect(live).toHaveLength(1);
    expect(live[0].dedupeKey).toBe(`live:${CASE}:${call.id}:C1`);
    expect(passagesOf(live[0].id).map((p) => p.turnId)).toEqual([t11]);
    expect(fromJson<string[]>(live[0].reasonCodesJson, [])).toEqual(["LIVE_ONLY", "R1", "R2", "R4", "TURN:T11"]);
    expect(live[0].explanation).toMatch(/^Live guidance flagged the expert's statement in T11: it met rule R1, rule R2 and rule R4 during the call\. The after-call read raised no policy finding on this turn/);
  });

  it("a live flag whose turns the transcript does not have is raised as a warning", async () => {
    await feed(22, dashboardClaimAtT7());
    const row = claimRows()[0];
    const record = fromJson<{ quotes: { turnLabel: string }[] }>(row.recordJson, { quotes: [] });
    getDb().update(callClaims).set({ recordJson: JSON.stringify({ ...record, quotes: record.quotes.map((q) => ({ ...q, turnLabel: "T99" })) }) }).where(eq(callClaims.id, row.id)).run();
    const r = end({ source: "gold" });
    await drainJobs();

    expect(liveFindings()).toEqual([]);
    const issues = issuesOf("LIVE_FLAG_UNMAPPED");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", resolved: false });
    expect(issues[0].message).toContain(row.id);
    expect(issues[0].message).toContain("T99");
    // Raised once, however often the flags are reconciled.
    transact((tx) => reconcileLiveFlags(tx, r.transcriptVersionId!));
    expect(issuesOf("LIVE_FLAG_UNMAPPED")).toHaveLength(1);
  });

  it("a live flag that quotes no turn is raised as a warning", async () => {
    await feed(22, dashboardClaimAtT7());
    const row = claimRows()[0];
    getDb().update(callClaims).set({ recordJson: JSON.stringify({ ...fromJson<object>(row.recordJson, {}), quotes: [] }) }).where(eq(callClaims.id, row.id)).run();
    end({ source: "gold" });
    await drainJobs();
    expect(liveFindings()).toEqual([]);
    expect(issuesOf("LIVE_FLAG_UNMAPPED").map((i) => i.message)).toEqual([`Live flag ${row.id} (claim ${row.logicalKey}) quotes no turn, so no passage could be hidden for it.`]);
  });

  it("if keeping the live flags fails after a failed read, the case is blocked", async () => {
    await feed(22);
    end();
    getDb().run(sql`DROP TABLE finding_passages`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await drainJobs();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(issuesOf("LLM_REPLAY_MISS")).toHaveLength(1);
    const failed = issuesOf("LIVE_RECONCILE_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ severity: "blocking", resolved: false });
    expect(failed[0].message).toMatch(/finding_passages/);
  });

  it("if the after-call read fails, every live flag still becomes a finding", async () => {
    await feed(22);
    const flagged = claimRows().filter((c) => c.flagged !== "none");
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    // The model read has no recording in replay mode, so the after-call read fails for good.
    end();
    await drainJobs();
    expect(issuesOf("LLM_REPLAY_MISS")).toHaveLength(1);
    expect(statusOf()).toBe("ANALYSIS_FAILED");

    const live = liveFindings();
    expect(live.map((f) => f.dedupeKey).sort()).toEqual(flagged.map((c) => `live:${CASE}:${c.id}`).sort());
    for (const f of live) {
      expect(passagesOf(f.id).length).toBeGreaterThanOrEqual(1);
      expect(openTasks(f.id, "review")).toHaveLength(1);
    }
    // The margin remark (C8, T17) never had its source stated: the call could not rule R1 out.
    expect(flagged.map((c) => [c.logicalKey, c.flagged])).toEqual([["C1", "review_required"], ["C7", "review_required"], ["C8", "needs_context"]]);
    const margin = live.find((x) => x.dedupeKey === `live:${CASE}:${call.id}:C8`)!;
    expect(margin.explanation).toBe("Live guidance flagged the expert's statement in T17: it could not rule out rule R1 by the end of the call. The after-call read did not finish, so it stays hidden from the banker until compliance decides.");
    expect(fromJson<string[]>(margin.reasonCodesJson, [])).toEqual(["LIVE_ONLY", "R1", "TURN:T17"]);
    const bookings = live.find((x) => x.dedupeKey === `live:${CASE}:${call.id}:C1`)!;
    expect(passagesOf(bookings.id).map((p) => p.turnId.split(":").at(-1))).toEqual(["T5", "T11"]);
    expect(bookings.explanation).toMatch(/^Live guidance flagged the expert's statements in T5 and T11: it met rule R1, rule R2 and rule R4 during the call\./);
  });

  it("Review Focus 3: a call with no expert speech ends cleanly", async () => {
    await ingestTurn(call.id, { ...asInput(halvorsen[1]), seq: 1 }, priya(), { reader: goldReader() }); // an analyst turn only
    expect(end()).toEqual({ hiddenCount: 0, pillText: "Call ended. Nothing was hidden.", jobId: null, transcriptVersionId: null });
    expect(callRow().status).toBe("abandoned");
    expect(callRow().endedAt).not.toBeNull();
    expect(getDb().select().from(jobs).where(eq(jobs.type, "analyze_transcript")).all().filter((j) => j.status === "queued")).toEqual([]);
    expect(statusOf()).toBe("INTAKE");
  });

  it("a call ended before anyone spoke ends cleanly", () => {
    expect(end()).toEqual({ hiddenCount: 0, pillText: "Call ended. Nothing was hidden.", jobId: null, transcriptVersionId: null });
    expect(callRow().status).toBe("abandoned");
  });

  it("only the banker who started the call can end it", async () => {
    await feed(3);
    expect(appError(() => transact((tx) => endCall(tx, call.id, user("marcus"))))).toMatchObject({ status: 404 });
    expect(callRow().status).toBe("live");
  });

  it("an outage becomes a warning on the case", async () => {
    await feed(3);
    const at = CALL_START + 60_000;
    const { outageId } = transact((tx) => recordOutage(tx, call.id, { stage: "transcribing", startedAt: iso(at), endedAt: iso(at + 19_000), cause: "the transcription socket closed", shownToBanker: true }, priya()));
    expect(getDb().select().from(callOutages).where(eq(callOutages.id, outageId)).get()).toMatchObject({ callId: call.id, stage: "transcribing", cause: "the transcription socket closed", shownToBanker: true });
    end();
    const gaps = issuesOf("CALL_GAP");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ severity: "warning", resolved: false });
    expect(gaps[0].message).toMatch(/19 seconds/);
    expect(fromJson<{ outageId: string }>(gaps[0].refJson, { outageId: "" }).outageId).toBe(outageId);
  });

  it("an outage still open when the call ends lasts until the end", async () => {
    await feed(3);
    const at = CALL_START + 60_000;
    transact((tx) => recordOutage(tx, call.id, { stage: "hearing", startedAt: iso(at), endedAt: null, cause: "the system audio stopped", shownToBanker: true }, priya()));
    setClockForTests(() => new Date(at + 45_000));
    end();
    expect(issuesOf("CALL_GAP")[0].message).toMatch(/45 seconds/);
  });

  it("an acknowledgement stores when the pill was shown", async () => {
    await post(1);
    const shownAt = iso(CALL_START + 9_000);
    const responseReceivedAt = iso(CALL_START + 8_900);
    transact((tx) => ackTurn(tx, call.id, { seq: 1, responseReceivedAt, shownAt }, priya()));
    expect(turnRow(1)).toMatchObject({ shownAt, responseReceivedAt });
    // A repeated acknowledgement keeps the first times.
    transact((tx) => ackTurn(tx, call.id, { seq: 1, responseReceivedAt: iso(CALL_START + 20_000), shownAt: iso(CALL_START + 20_100) }, priya()));
    expect(turnRow(1)).toMatchObject({ shownAt, responseReceivedAt });
    expect(appError(() => transact((tx) => ackTurn(tx, call.id, { seq: 2, responseReceivedAt, shownAt }, priya())))).toMatchObject({ status: 404 });
    expect(appError(() => transact((tx) => ackTurn(tx, call.id, { seq: 1, responseReceivedAt, shownAt }, user("marcus"))))).toMatchObject({ status: 404 });
  });

  it("reconciling a transcript no call owns does nothing", () => {
    expect(transact((tx) => reconcileLiveFlags(tx, "tv_not_a_call"))).toEqual({ created: [] });
  });
});
