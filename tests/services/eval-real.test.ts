/**
 * The real-material harness (Task 37): the scorer, and the runner driven end to
 * end on a made-up call with the model stubbed out. No network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmClaimWire, LlmExtractionWire } from "@/core/extraction/schema";
import { resetDbForTests } from "@/server/db/client";
import { type RealCaseScore, readCoverage, repeatAgreement, runRealEval, scoreRealCase } from "@/server/eval/real";
import { words } from "../helpers/prompt-leak";

const stub = vi.hoisted(() => ({ extraction: null as unknown }));
vi.mock("@/server/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm/client")>();
  return {
    ...actual,
    structuredCall: vi.fn(async () => {
      if (!stub.extraction) throw new Error("no stubbed extraction");
      return { data: stub.extraction, callId: null, replayed: false, recordedAt: null, requestHash: "stub" };
    }),
  };
});

describe("scoreRealCase", () => {
  it("counts a labelled turn a flagged claim quotes as hidden, and one an unflagged claim quotes as not flagged", () => {
    const score = scoreRealCase(
      [{ turn: "T2" }, { turn: "T4" }],
      [
        { turns: ["T2"], state: "REVIEW_REQUIRED" },
        { turns: ["T4"], state: "NOT_TRIGGERED" },
      ],
      { T4: false },
    );
    expect(score).toMatchObject({ labelled: 2, hidden: 1, notExtracted: [], extractedNotFlagged: [{ turn: "T4", covered: false }] });
  });

  it("puts a labelled turn no claim quotes in notExtracted", () => {
    const score = scoreRealCase([{ turn: "T2" }, { turn: "T7" }], [{ turns: ["T2"], state: "NEEDS_CONTEXT" }], {});
    expect(score).toMatchObject({ labelled: 2, hidden: 1, notExtracted: ["T7"], extractedNotFlagged: [] });
  });

  it("treats escalation and needs-context as hidden, and a turn not yet judged as covered: null", () => {
    const score = scoreRealCase(
      [{ turn: "T1" }, { turn: "T3" }, { turn: "T5" }],
      [
        { turns: ["T1"], state: "ESCALATION_REQUESTED" },
        { turns: ["T3", "T6"], state: "NEEDS_CONTEXT" },
        { turns: ["T5"], state: "UNASSESSED" },
      ],
      { T5: true },
    );
    expect(score).toMatchObject({ labelled: 3, hidden: 2, notExtracted: [], extractedNotFlagged: [{ turn: "T5", covered: true }], otherHidden: 1 });
    expect(scoreRealCase([{ turn: "T5" }], [{ turns: ["T5"], state: "NOT_TRIGGERED" }], {}).extractedNotFlagged).toEqual([{ turn: "T5", covered: null }]);
  });

  it("counts every unlabelled turn a flagged claim quotes once, as another passage hidden", () => {
    const score = scoreRealCase(
      [],
      [
        { turns: ["T2", "T3"], state: "REVIEW_REQUIRED" },
        { turns: ["T3"], state: "NEEDS_CONTEXT" },
        { turns: ["T9"], state: "NOT_TRIGGERED" },
      ],
      {},
    );
    expect(score).toMatchObject({ labelled: 0, hidden: 0, otherHidden: 2, hiddenTurns: ["T2", "T3"] });
  });

  it("a labelled turn counts once even when the labels repeat it", () => {
    expect(scoreRealCase([{ turn: "T2" }, { turn: "T2" }], [{ turns: ["T2"], state: "REVIEW_REQUIRED" }], {})).toMatchObject({ labelled: 1, hidden: 1 });
  });
});

describe("repeatAgreement", () => {
  const run = (n: number, hiddenTurns: string[], error: string | null = null): RealCaseScore => ({ ...scoreRealCase([], [], {}, { id: "c", policy: "p" }), run: n, hiddenTurns, error });
  it("counts how many runs gave the most common hidden turns, leaving out runs that failed", () => {
    expect(repeatAgreement([run(1, ["T1"]), run(2, ["T1"]), run(3, ["T1", "T2"]), run(4, ["T1"]), run(5, [], "LLM_REFUSAL")])).toEqual([{ id: "c", policy: "p", runs: 5, agreeing: 3, modal: ["T1"], errors: 1 }]);
  });
  it("nothing hidden on every run is agreement too", () => {
    expect(repeatAgreement([run(1, []), run(2, [])])[0]).toMatchObject({ agreeing: 2, modal: [] });
  });
});

// ── The runner, on a made-up call ───────────────────────────────────────────

const TRANSCRIPT = [
  "Analyst (Pat Doe): How did the quarter look from where you sit?",
  "Expert (Sam Roe): Our internal dashboard showed widget orders fell by a third this quarter, and nobody outside has seen that number yet.",
  "Analyst (Pat Doe): And the wider industry?",
  "Expert (Sam Roe): The industry overall is growing slowly, according to the trade press.",
  "Expert (Sam Roe): I also remember the weather being unusually warm that summer.",
].join("\n");

function wireClaim(over: Partial<LlmClaimWire> & Pick<LlmClaimWire, "logical_key" | "summary" | "quotes">): LlmClaimWire {
  return {
    speaker: "expert",
    subject_kind: "issuer",
    subject_name: "Acme Widgets",
    metric_category: "none",
    metric_label: "",
    event_kind: "none",
    period_label: "",
    period_relative: "unspecified",
    fiscal_year: 0,
    fiscal_quarter: 0,
    calendar_year: 0,
    calendar_quarter: 0,
    value_number: null,
    value_unit: "none",
    value_direction: "none",
    value_baseline: "",
    scope: "company_wide",
    scope_detail: "",
    knowledge_basis: "public_source",
    access_timing: "not_applicable",
    confidentiality_signals: [],
    qualifications: [],
    is_correction_of: "",
    links: [],
    solicited_by_analyst: "no",
    field_uncertainty: [],
    ...over,
  };
}

const EXTRACTION: LlmExtractionWire = {
  claims: [
    wireClaim({
      logical_key: "C1",
      summary: "Widget orders fell by a third this quarter, per the internal dashboard.",
      metric_category: "orders",
      metric_label: "widget orders",
      period_relative: "current",
      value_number: -33,
      value_unit: "percent",
      value_direction: "down",
      knowledge_basis: "internal_system",
      access_timing: "during_employment",
      confidentiality_signals: ["nobody outside has seen that number yet"],
      quotes: [{ turn_id: "T2", quote: "Our internal dashboard showed widget orders fell by a third this quarter", role: "primary", supports_fields: ["knowledge_basis"] }],
    }),
    wireClaim({
      logical_key: "C2",
      summary: "The industry is growing slowly, according to the trade press.",
      subject_kind: "industry",
      subject_name: "",
      quotes: [{ turn_id: "T4", quote: "The industry overall is growing slowly, according to the trade press.", role: "primary", supports_fields: [] }],
    }),
  ],
  suggested_concerns: [],
  missing_context_questions: [],
  call_summary: "",
};

function writeCase(root: string, id: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const json = (name: string, value: unknown) => writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(join(dir, "transcript.txt"), `${TRANSCRIPT}\n`);
  json("packet.json", {
    title: "Acme Widgets — made-up check",
    issuer: "Acme Widgets Inc.",
    ticker: "ACME",
    aliases: ["Acme Widgets", "Acme"],
    issuer_fiscal: { fiscal_year_end_month: 12, last_reported: { fy: 2025, q: 2, reported_on: "2025-07-20" }, next_report_expected: null },
    call_date: "2025-08-10",
    research_questions: ["Demand for widgets"],
  });
  json("expert.json", { name: "Sam Roe", current_employer: "Retired", current_title: "", employment: [], network: "", network_attestation: {} });
  json("speakers.json", { "Pat Doe": "analyst", "Sam Roe": "expert" });
  json("labels.json", { labels: [{ turn: "T2" }, { turn: "T4" }, { turn: "T5" }] });
  json("coverage-oaktree.json", { T4: { covered: false, clause: "none" } });
}

/** Every run of four consecutive words in the transcript's turns (speaker labels left out). */
function fourGrams(): string[] {
  const grams: string[] = [];
  for (const line of TRANSCRIPT.split("\n")) {
    const w = words(line.slice(line.indexOf(":") + 1));
    for (let i = 0; i + 4 <= w.length; i++) grams.push(w.slice(i, i + 4).join(" "));
  }
  return grams;
}

describe("runRealEval", () => {
  let root: string;
  beforeEach(() => {
    resetDbForTests();
    stub.extraction = EXTRACTION;
    root = mkdtempSync(join(tmpdir(), "blink-eval-real-"));
    writeCase(root, "made-up");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates a case per policy, runs the after-call pipeline and scores each one", async () => {
    const scores = await runRealEval({ dir: root, policies: ["oaktree", "demo"], countsOnly: true, log: () => undefined });
    expect(scores.map((s) => [s.id, s.policy])).toEqual([
      ["made-up", "oaktree"],
      ["made-up", "demo"],
    ]);
    const oaktree = scores[0];
    expect(oaktree.error).toBeNull();
    expect(oaktree).toMatchObject({ labelled: 3, hidden: 1, notExtracted: ["T5"], extractedNotFlagged: [{ turn: "T4", covered: false }], otherHidden: 0, hiddenTurns: ["T2"], claims: 2 });
    // The demo policy has no coverage file, so its unflagged turns are not yet judged.
    expect(scores[1].extractedNotFlagged.every((t) => t.covered === null)).toBe(true);
  });

  it("with --counts-only prints numbers and ids, and never four words in a row from the transcript", async () => {
    const lines: string[] = [];
    await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: true, log: (l) => lines.push(l) });
    const out = words(lines.join("\n")).join(" ");
    expect(lines.join("\n")).toMatch(/made-up/);
    for (const gram of fourGrams()) expect(out.includes(gram), `printed "${gram}"`).toBe(false);
  });

  it("without --counts-only prints what each claim quoted (so the check above can fail)", async () => {
    const lines: string[] = [];
    await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: false, log: (l) => lines.push(l) });
    const out = words(lines.join("\n")).join(" ");
    expect(fourGrams().some((gram) => out.includes(gram))).toBe(true);
  });

  it("only the calls asked for", async () => {
    writeCase(root, "another");
    const scores = await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: true, calls: ["another"], log: () => undefined });
    expect(scores.map((s) => s.id)).toEqual(["another"]);
  });

  it("a call whose analysis fails is reported as an error, never scored as hidden", async () => {
    stub.extraction = null;
    const [score] = await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: false, log: () => undefined });
    expect(score.error).toMatch(/^ANALYSIS_ERROR: .*no stubbed extraction/);
    expect(score.hidden).toBe(0);
    // With countsOnly the score itself, which the script writes to disk, keeps the code alone.
    const [quiet] = await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: true, log: () => undefined });
    expect(quiet.error).toBe("ANALYSIS_ERROR");
  });

  it("with --counts-only an error is printed by its code alone", async () => {
    stub.extraction = null;
    const lines: string[] = [];
    await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: true, log: (l) => lines.push(l) });
    expect(lines.join("\n")).toMatch(/made-up · oaktree · run 1: ERROR \(ANALYSIS_ERROR\)/);
    expect(lines.join("\n")).not.toMatch(/stubbed/);
  });

  it("with --counts-only a transcript that will not parse is an error on the score, and none of its words is printed", async () => {
    const bad = "this opening line has no speaker label so the parser quotes it back";
    writeFileSync(join(root, "made-up", "transcript.txt"), `${bad}\n${TRANSCRIPT}\n`);
    const lines: string[] = [];
    const scores = await runRealEval({ dir: root, policies: ["oaktree", "demo"], countsOnly: true, log: (l) => lines.push(l) });
    expect(scores.map((s) => s.error)).toEqual(["VALIDATION", "VALIDATION"]);
    const out = words(`${lines.join("\n")}\n${JSON.stringify(scores)}`).join(" ");
    const w = words(bad);
    for (let i = 0; i + 4 <= w.length; i++) expect(out.includes(w.slice(i, i + 4).join(" ")), `printed "${w.slice(i, i + 4).join(" ")}"`).toBe(false);
    // Without countsOnly the message is kept, so the check above is not vacuous.
    const [loud] = await runRealEval({ dir: root, policies: ["oaktree"], countsOnly: false, log: () => undefined });
    expect(loud.error).toMatch(/no speaker label/);
  });

  it("with --counts-only a malformed JSON file is an error on every policy's score, printed by class name", async () => {
    writeFileSync(join(root, "made-up", "labels.json"), "{ not json at all, a secret phrase here");
    const lines: string[] = [];
    const scores = await runRealEval({ dir: root, policies: ["oaktree", "demo"], countsOnly: true, log: (l) => lines.push(l) });
    expect(scores.map((s) => [s.policy, s.error])).toEqual([
      ["oaktree", "SyntaxError"],
      ["demo", "SyntaxError"],
    ]);
    expect(`${lines.join("\n")}${JSON.stringify(scores)}`).not.toMatch(/secret phrase/);
  });

  it("refuses a coverage file of the wrong shape", () => {
    writeFileSync(join(root, "made-up", "coverage-tcw.json"), JSON.stringify({ T4: { covered: "yes", clause: "none" } }));
    expect(() => readCoverage(join(root, "made-up"), "tcw")).toThrow();
    writeFileSync(join(root, "made-up", "coverage-tcw.json"), JSON.stringify({ T4: { covered: true, clause: "P9" } }));
    expect(readCoverage(join(root, "made-up"), "tcw")).toEqual({ T4: true });
  });

  it("refuses an unknown policy name", async () => {
    await expect(runRealEval({ dir: root, policies: ["nope"], countsOnly: true, log: () => undefined })).rejects.toThrow(/nope/);
  });
});
