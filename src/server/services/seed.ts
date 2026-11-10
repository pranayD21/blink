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
import type { LiveTurn } from "@/core/live/transcript";
import { parseTranscript } from "@/core/transcript/parse";
import { DEMO_USERS, demoEmail, loadActor } from "../auth/actor";
import { hashPassword } from "../auth/password";
import { appendAudit } from "../audit/log";
import { type Tx, transact } from "../db/client";
import { cases, users } from "../db/schema";
import { enqueueJob } from "../jobs/queue";
import { drainJobs } from "../jobs/runner";
import { type CreateCaseInput, CreateCaseSchema, createCase, ensureDefaultDocumentSet } from "./cases";
import { getDocument, parseDocumentFile, saveDocumentFacts, upsertDocument } from "./documents";
import { approvePolicy, createPolicy, loadManualFallback } from "./policies";
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

const MS_PER_WORD = 375; // about 160 words a minute
const GAP_MS = 300;

const clockMs = (stamp: string): number => {
  const [h, m, s] = stamp.split(":").map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
};

/**
 * Transcript v1 as the live app would send it. A moderator's turn is "expert", as it would be on
 * the system-audio channel. Speech starts at the turn's timestamp and ends after a speaking time
 * for its length, but always before the next turn starts. The scripted call (`pnpm record:live`,
 * the dev route behind `/desktop?source=script`) and the live-call tests all play these turns.
 */
export function halvorsenLiveTurns(): LiveTurn[] {
  const parsed = parseTranscript(readFixtureText("cases", "halvorsen", "transcript-v1.txt"), { filename: "transcript-v1.txt" }).turns;
  const starts = parsed.map((t) => clockMs(t.timestamp!));
  return parsed.map((t, i) => {
    const start = starts[i];
    const spoken = start + t.text.split(/\s+/).length * MS_PER_WORD;
    const end = i + 1 < parsed.length ? Math.min(spoken, starts[i + 1] - GAP_MS) : spoken;
    return { seq: t.idx, speaker: t.speaker === "analyst" ? "analyst" : "expert", text: t.text, speechStartMs: start, speechEndMs: Math.max(end, start + GAP_MS) };
  });
}

export function fixturePolicyInput(file: "blink-demo-policy-v1.md" | "blink-demo-policy-v1-broken.md") {
  const text = readFixtureText("policy", file);
  const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? file;
  return { title, text, requiredParagraphs: FIXTURE_REQUIRED_PARAGRAPHS, scenarios: readFixtureJson("policy", "scenarios-v1.json") };
}

/**
 * Passwords for the demo accounts come from `BLINK_SEED_PASSWORDS`, a JSON object keyed by user id.
 * A user it does not name keeps no password, so nobody can sign in as them. The value is never logged,
 * and a malformed one is reported without quoting it.
 */
function seedPasswords(): Record<string, string> {
  const raw = process.env.BLINK_SEED_PASSWORDS;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BLINK_SEED_PASSWORDS is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === "string" && v.length > 0)) {
    throw new Error('BLINK_SEED_PASSWORDS must be a JSON object of non-empty strings keyed by user id, like {"user_priya": "..."}');
  }
  // A key that is not a demo user is a typo (or a password pasted as a key), so it is named by count, never quoted.
  const known = new Set(DEMO_USERS.map((u) => u.id));
  const unknown = Object.keys(parsed).filter((k) => !known.has(k)).length;
  if (unknown > 0) {
    throw new Error(`BLINK_SEED_PASSWORDS has ${unknown} key${unknown === 1 ? "" : "s"} that ${unknown === 1 ? "is" : "are"} not a demo user id; the ids are ${[...known].join(", ")}`);
  }
  return parsed as Record<string, string>;
}

/**
 * Inserts the demo users that are missing and fills in what an existing one lacks: its email, and
 * a password `BLINK_SEED_PASSWORDS` names when it has none. A password that is already set is never
 * replaced. Touches the users table and nothing else.
 */
function seedUsers(tx: Tx): { inserted: number; updated: number } {
  const passwords = seedPasswords();
  let inserted = 0;
  let updated = 0;
  for (const user of DEMO_USERS) {
    const existing = tx.select().from(users).where(eq(users.id, user.id)).get();
    const password = passwords[user.id];
    if (!existing) {
      tx.insert(users).values({ ...user, email: demoEmail(user.name), passwordHash: password ? hashPassword(password) : null }).run();
      inserted++;
      continue;
    }
    const fill: { email?: string; passwordHash?: string } = {};
    if (!existing.email) fill.email = demoEmail(user.name);
    if (!existing.passwordHash && password) fill.passwordHash = hashPassword(password);
    if (Object.keys(fill).length) {
      tx.update(users).set(fill).where(eq(users.id, user.id)).run();
      updated++;
    }
  }
  return { inserted, updated };
}

/** `tsx scripts/seed.ts --users-only`: the start script's re-seed of a database that already holds data. */
export function seedUsersOnly(): { inserted: number; updated: number } {
  return transact((tx) => seedUsers(tx));
}

export function seedBase(options: SeedOptions = {}): { caseId: string; documents: string[] } {
  return transact((tx) => {
    seedUsers(tx);
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
    const result = loadManualFallback(tx, policyVersionId, owner);
    if (result.status !== "VALIDATED") throw new Error("the manual fallback policy did not validate");
    approvePolicy(tx, policyVersionId, result.bundleHash, owner);
    return policyVersionId;
  });
}

export async function seedDatabase(options: SeedOptions = {}): Promise<{ caseId: string; policyVersionId: string | null }> {
  // Hand-labeled claims come with hand-written document facts, so the comparison works with no model at all.
  const { caseId } = seedBase({ ...options, goldDocFacts: options.goldDocFacts ?? options.gold, enqueueDocFacts: options.gold ? false : options.enqueueDocFacts });
  const policyVersionId = options.manualPolicy ? activateManualPolicy() : null;
  if (options.gold) {
    transact((tx) => uploadTranscript(tx, caseId, { text: readFixtureText("cases", "halvorsen", "transcript-v1.txt"), filename: "transcript-v1.txt", sourceLabel: "Meridian transcript v1", source: "gold" }, loadActor(tx, "user_priya")));
    await drainJobs();
  }
  return { caseId, policyVersionId };
}
