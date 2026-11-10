/**
 * Sources for the prompt-leak test: every fixed piece of text Blink sends to a
 * model, and every piece of fixture text the prompts are scored on. A prompt
 * that shares a five-word run with a fixture has been tuned on the answer key.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ValidationIssue } from "@/core/policy/validate";
import type { CaseContext, ExpertProfile } from "@/core/types";
import { BRIEF_SYSTEM, buildBriefUser } from "@/server/llm/prompts/brief";
import { DOCFACTS_SYSTEM, buildDocFactsUser } from "@/server/llm/prompts/docfacts";
import { EXTRACT_SYSTEM, buildExtractUser } from "@/server/llm/prompts/extract";
import { FIELD_GUIDE } from "@/server/llm/prompts/fields";
import { ASSEMBLY_SYSTEM, PASS_A_SYSTEM, PASS_B_SYSTEM, SCENARIOS_SYSTEM, buildAssemblyUser, buildPassAUser, buildPassBUser, buildScenariosUser } from "@/server/llm/prompts/policy";

const FIXTURES = join(__dirname, "..", "..", "fixtures");

/** Lower-case, punctuation stripped, split on whitespace: the words of a text. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function fiveGrams(text: string): Set<string> {
  const w = words(text);
  const grams = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) grams.add(w.slice(i, i + 5).join(" "));
  return grams;
}

// Builder inputs carry no case content, so a builder contributes only its fixed text.
const EMPTY_CTX: CaseContext = { issuer: "", ticker: "", aliases: [], callDate: "", fiscal: { fiscal_year_end_month: 12, last_reported: { fy: 0, q: 1, reported_on: "" }, next_report_expected: null } };
const EMPTY_EXPERT: ExpertProfile = { name: "", current_title: "", current_employer: "", employment: [], network: "", network_attestation: {} };
const ISSUE: ValidationIssue[] = [{ code: "SCHEMA_INVALID", severity: "blocking", message: "" }];
const EMPTY_RULES = { rules: [], unsupported_clauses: [] };

/** Every system prompt, and the fixed text of every user-prompt builder (including the predicate vocabulary Pass B sends). */
export function promptSources(): string[] {
  return [
    FIELD_GUIDE,
    EXTRACT_SYSTEM,
    buildExtractUser({ ctx: EMPTY_CTX, researchQuestions: [], expert: EMPTY_EXPERT, turns: [] }),
    PASS_A_SYSTEM,
    buildPassAUser([]),
    PASS_B_SYSTEM,
    buildPassBUser({ paragraphs: [], inventory: { clauses: [] }, feedback: ISSUE }),
    ASSEMBLY_SYSTEM,
    buildAssemblyUser({ rulesDoc: EMPTY_RULES, feedback: { issues: ISSUE, previous: [] } }),
    SCENARIOS_SYSTEM,
    buildScenariosUser(EMPTY_RULES),
    BRIEF_SYSTEM,
    buildBriefUser({ caseTitle: "", issuer: "", researchQuestions: [], claims: [] }),
    DOCFACTS_SYSTEM,
    buildDocFactsUser({ title: "", sourceType: "", issuer: "", relatedIssuers: [], publishedAt: "", body: "" }),
  ];
}

function realTranscripts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...realTranscripts(path));
    else if (entry.name === "transcript.txt") out.push(readFileSync(path, "utf8"));
  }
  return out;
}

/** The Halvorsen transcripts, every variant transcript, both demo policies, and any real test transcripts. */
export function fixtureSources(): string[] {
  const read = (...p: string[]) => readFileSync(join(FIXTURES, ...p), "utf8");
  const variants = readdirSync(join(FIXTURES, "cases", "variants"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => (JSON.parse(read("cases", "variants", f)) as { transcript: string }).transcript);
  return [
    read("cases", "halvorsen", "transcript-v1.txt"),
    read("cases", "halvorsen", "transcript-v2.txt"),
    ...variants,
    read("policy", "blink-demo-policy-v1.md"),
    read("policy", "blink-demo-policy-v1-broken.md"),
    ...realTranscripts(join(FIXTURES, "real")),
  ];
}
