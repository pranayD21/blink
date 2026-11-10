/** Tables for live calls: a call, its turns and claims store, and a turn's seq is unique per call. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/server/db/client";
import { callClaims, callOutages, callTurns, calls, findingPassages } from "@/server/db/schema";

const T0 = "2026-11-10T15:00:00.000Z";

function insertCall(id: string) {
  getDb()
    .insert(calls)
    .values({
      id,
      caseId: "case_1",
      startedBy: "user_1",
      policyVersionId: "pv_1",
      status: "live",
      startedAt: T0,
      readerModel: "reader-model",
      readerPromptVersion: "v1",
    })
    .run();
}

function insertTurn(callId: string, seq: number) {
  getDb()
    .insert(callTurns)
    .values({
      id: `${callId}:${seq}`,
      callId,
      seq,
      speaker: "expert",
      text: "We shipped the units.",
      textHash: "hash",
      speechEndMs: 4200,
      speechEndedAt: T0,
      transcribedAt: T0,
      receivedAt: T0,
      decidedAt: T0,
      readStatus: "read",
      pill: "listening",
      pillReason: "nothing to flag",
      suppressed: false,
    })
    .run();
}

describe("live call tables", () => {
  beforeEach(() => resetDbForTests());

  it("a call, a turn and a claim can be stored, and a turn's seq is unique per call", () => {
    insertCall("call_1");
    insertTurn("call_1", 1);
    getDb()
      .insert(callClaims)
      .values({ id: "call_1:k1", callId: "call_1", logicalKey: "k1", recordJson: "{}", flagged: "none", updatedAt: T0 })
      .run();

    const call = getDb().select().from(calls).where(eq(calls.id, "call_1")).get();
    expect(call).toMatchObject({ hiddenCount: 0, version: 1, endedAt: null });
    const turn = getDb().select().from(callTurns).where(eq(callTurns.id, "call_1:1")).get();
    expect(turn).toMatchObject({ claimsJson: "[]", evaluationsJson: "[]", rejectedJson: "[]", pillRuleIdsJson: "[]", suppressed: false });
    const claim = getDb().select().from(callClaims).get();
    expect(claim).toMatchObject({ monitorStatesJson: "[]", ruleIdsJson: "[]", firstFlaggedSeq: null });

    expect(() => insertTurn("call_1", 1)).toThrow(/UNIQUE/);
    insertTurn("call_1", 2);
    insertCall("call_2");
    insertTurn("call_2", 1);
  });

  it("outages and hidden passages can be stored", () => {
    insertCall("call_1");
    getDb()
      .insert(callOutages)
      .values({ id: "o1", callId: "call_1", stage: "hearing", startedAt: T0, cause: "no audio", shownToBanker: true })
      .run();
    getDb().insert(findingPassages).values({ id: "p1", findingId: "f1", turnId: "call_1:1", startChar: 0, endChar: 5 }).run();
    expect(getDb().select().from(callOutages).get()).toMatchObject({ endedAt: null, shownToBanker: true });
    expect(getDb().select().from(findingPassages).get()).toMatchObject({ startChar: 0, endChar: 5 });
  });
});
