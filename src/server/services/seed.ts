/**
 * Seeds a database from fixtures (§16 Phase 0): the four demo users, the
 * curated documents, and the Halvorsen case packet and expert.
 *
 * The default seed is the demo's starting point: nothing compiled, nothing
 * analyzed, so every step of §19 happens in front of the audience. The
 * options exist for development and tests.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { DEMO_USERS, loadActor } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { type Db, getDb, transact } from "../db/client";
import { cases, users } from "../db/schema";
import { enqueueJob } from "../jobs/queue";
import { drainJobs } from "../jobs/runner";
import { type CreateCaseInput, CreateCaseSchema, createCase, ensureDefaultDocumentSet } from "./cases";
import { getDocument, parseDocumentFile, saveDocumentFacts, upsertDocument } from "./documents";
import { approvePolicy, createPolicy, useManualFallback } from "./policies";
import { uploadTranscript } from "./transcripts";

export const HALVORSEN_CASE_ID = "case_halvorsen";
export const FIXTURE_REQUIRED_PARAGRAPHS = ["P2", "P3", "P4", "P5"];

const fixture = (...parts: string[]) => resolve(process.cwd(), "fixtures", ...parts);
export const readFixtureText = (...parts: string[]) => readFileSync(fixture(...parts), "utf8");
export const readFixtureJson = <T = unknown>(...parts: string[]) => JSON.parse(readFixtureText(...parts)) as T;

export interface SeedOptions {
  /** Activate the labeled hand-written fallback policy (dev and tests; the demo compiles live). */
  manualPolicy?: boolean;
  /** Upload transcript v1 and load the hand-labeled claims instead of calling the model (dev and tests). */
  gold?: boolean;
  /** Queue the document-facts extraction for the worker. Default true. */
  enqueueDocFacts?: boolean;
  /** Load the hand-written document facts instead of extracting them (tests; no model call). */
  goldDocFacts?: boolean;
}

export function halvorsenCaseInput(): CreateCaseInput {
  const packet = readFixtureJson<Record<string, unknown>>("cases", "halvorsen", "packet.json");
  const expert = readFixtureJson<Record<string, unknown>>("cases", "halvorsen", "expert.json");
  return CreateCaseSchema.parse({ ...packet, expert });
}

export function fixturePolicyInput(file: "blink-demo-policy-v1.md" | "blink-demo-policy-v1-broken.md") {
  const text = readFixtureText("policy", file);
  const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? file;
  return { title, text, requiredParagraphs: FIXTURE_REQUIRED_PARAGRAPHS, scenarios: readFixtureJson("policy", "scenarios-v1.json") };
}

export function seedBase(db: Db = getDb(), options: SeedOptions = {}): { caseId: string; documents: string[] } {
  return transact((tx) => {
    for (const user of DEMO_USERS) {
      if (!tx.select().from(users).where(eq(users.id, user.id)).get()) tx.insert(users).values(user).run();
    }
    const documentIds: string[] = [];
    for (const file of readdirSync(fixture("documents")).filter((f) => f.endsWith(".md")).sort()) {
      const input = parseDocumentFile(file.replace(/\.md$/, ""), readFixtureText("documents", file));
      upsertDocument(tx, input);
      documentIds.push(input.id);
    }
    ensureDefaultDocumentSet(tx);

    if (options.goldDocFacts) {
      const gold = readFixtureJson<{ documents: Record<string, Parameters<typeof saveDocumentFacts>[2]> }>("documents", "gold-facts.json").documents;
      for (const id of documentIds) if (getDocument(tx, id).factsStatus !== "extracted") saveDocumentFacts(tx, id, gold[id] ?? [], null, []);
    } else if (options.enqueueDocFacts !== false) {
      for (const id of documentIds) {
        const doc = getDocument(tx, id);
        if (doc.factsStatus !== "extracted") enqueueJob(tx, "extract_doc_facts", { documentId: id }, { idempotencyKey: `docfacts:${id}:${doc.bodyHash.slice(0, 12)}` });
      }
    }

    if (!tx.select().from(cases).where(eq(cases.id, HALVORSEN_CASE_ID)).get()) {
      createCase(tx, halvorsenCaseInput(), loadActor(tx, "user_priya"), { id: HALVORSEN_CASE_ID });
    }
    appendAudit(tx, { actorId: "system", type: "DATABASE_SEEDED", entityType: "system", entityId: "seed", payload: { users: DEMO_USERS.length, documents: documentIds.length, synthetic: true } });
    return { caseId: HALVORSEN_CASE_ID, documents: documentIds };
  });
}

/** Creates the demo policy from the fixture and activates the manual fallback as the policy owner. */
export function activateManualPolicy(): string {
  return transact((tx) => {
    const owner = loadActor(tx, "user_dana");
    const { policyVersionId } = createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), owner);
    const result = useManualFallback(tx, policyVersionId, owner);
    if (result.status !== "VALIDATED") throw new Error("the manual fallback policy did not validate");
    approvePolicy(tx, policyVersionId, result.bundleHash, owner);
    return policyVersionId;
  });
}

export async function seedDatabase(options: SeedOptions = {}): Promise<{ caseId: string; policyVersionId: string | null }> {
  const { caseId } = seedBase(getDb(), { ...options, enqueueDocFacts: options.gold ? false : options.enqueueDocFacts });
  const policyVersionId = options.manualPolicy ? activateManualPolicy() : null;
  if (options.gold) {
    transact((tx) => uploadTranscript(tx, caseId, { text: readFixtureText("cases", "halvorsen", "transcript-v1.txt"), filename: "transcript-v1.txt", sourceLabel: "Meridian transcript v1", source: "gold" }, loadActor(tx, "user_priya")));
    await drainJobs();
  }
  return { caseId, policyVersionId };
}
