/** §18.1 Audit chain: any hand edit is found, and the report names the sequence number. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit, verifyAuditChain } from "@/server/audit/log";
import { getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { CASE, G2, completeReview, dispose, findingOn, seedAnalyzed } from "../helpers/db";

beforeEach(seedAnalyzed);

describe("hash-chained audit log", () => {
  it("verifies after a full review, and every event links to the one before it", () => {
    completeReview();
    const result = verifyAuditChain(getDb());
    const events = listAudit(getDb());
    expect(result).toMatchObject({ ok: true, count: events.length });
    expect(events.length).toBeGreaterThan(40);
    for (let i = 1; i < events.length; i++) expect(events[i].prevHash).toBe(events[i - 1].hash);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it("records who decided what, on which evidence", () => {
    dispose(findingOn(G2).id, "restricted_exclude", "marcus");
    const event = listAudit(getDb(), CASE).findLast((e) => e.type === "FINDING_DISPOSITIONED")!;
    expect(event.actorId).toBe("user_marcus");
    expect(event.payload).toMatchObject({ label: "F2", outcome: "restricted_exclude", decided_by_role: "reviewer" });
    const evidence = event.payload.evidence as { source: string; label: string }[];
    expect(evidence.map((e) => e.source)).toEqual(expect.arrayContaining(["policy_version", "claim", "turn"]));
    expect(evidence.find((e) => e.source === "turn")!.label).toBe("T15");
  });

  it("editing a payload by hand → verify reports that sequence number", () => {
    dispose(findingOn(G2).id, "restricted_exclude", "marcus");
    const target = listAudit(getDb(), CASE).findLast((e) => e.type === "FINDING_DISPOSITIONED")!;
    const tampered = JSON.stringify({ ...target.payload, outcome: "cleared_for_research" });
    getDb().update(auditEvents).set({ payloadJson: tampered }).where(eq(auditEvents.seq, target.seq)).run();

    const result = verifyAuditChain(getDb());
    expect(result).toMatchObject({ ok: false, brokenSeq: target.seq });
    expect(result.ok ? "" : result.reason).toMatch(/does not match its hash/);
  });

  it("re-hashing a tampered event still breaks the chain at the next link", () => {
    const events = listAudit(getDb());
    const target = events[5];
    // An attacker who can recompute one hash still cannot fix every later link without rewriting them all.
    getDb().update(auditEvents).set({ hash: "a".repeat(64) }).where(eq(auditEvents.seq, target.seq)).run();
    expect(verifyAuditChain(getDb())).toMatchObject({ ok: false, brokenSeq: target.seq });
  });

  it("deleting an event → verify reports the gap", () => {
    getDb().delete(auditEvents).where(eq(auditEvents.seq, 4)).run();
    expect(verifyAuditChain(getDb())).toMatchObject({ ok: false, brokenSeq: 4 });
  });
});
