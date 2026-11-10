/**
 * The real development set (spec §11): calls quoted in public court, regulator
 * and Justice Department documents. Every turn must be the authority's own
 * words, every label must point at a real turn with a citation, and every
 * packet must load as a case.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "@/core/transcript/parse";
import { CreateCaseSchema } from "@/server/services/cases";

const REAL = join(__dirname, "..", "..", "fixtures", "real");
const DEV = join(REAL, "dev");
/** Cases whose source may not be published (see fixtures/real/README.md); checked only on a machine that has them. */
const LOCAL_DEV = join(homedir(), ".blink-real-local", "dev");

function casesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const caseDir = new Map<string, string>([...casesIn(DEV).map((id) => [id, join(DEV, id)] as const), ...casesIn(LOCAL_DEV).map((id) => [id, join(LOCAL_DEV, id)] as const)]);
const devCases = () => [...caseDir.keys()];

const read = (id: string, file: string) => readFileSync(join(caseDir.get(id)!, file), "utf8");
const readJson = <T>(id: string, file: string) => JSON.parse(read(id, file)) as T;

/** Collapse whitespace and straighten curly quotes, so line wrapping in the extracted text does not matter. */
function squash(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

interface Labels {
  labels: { turn: string; authority_says: string; cite: string }[];
}

describe("real development set", () => {
  it("has the public development calls", () => {
    expect(casesIn(DEV)).toEqual(["chu", "gupta-horowitz", "gupta-lau"]);
  });

  it("no public case shares a name with a private one", () => {
    for (const id of casesIn(LOCAL_DEV)) expect(casesIn(DEV)).not.toContain(id);
  });

  it.each(devCases())("%s: has every file", (id) => {
    for (const f of ["source.md", "source.txt", "transcript.txt", "speakers.json", "packet.json", "expert.json", "labels.json"]) expect(existsSync(join(caseDir.get(id)!, f)), `${id}/${f}`).toBe(true);
  });

  it.each(devCases())("%s: each speaker parses to the intended role", (id) => {
    const expected = readJson<Record<string, string>>(id, "speakers.json");
    const seen: Record<string, string> = {};
    for (const t of parseTranscript(read(id, "transcript.txt"), { filename: "t.txt" }).turns) seen[t.speakerName] = t.speaker;
    expect(seen).toEqual(expected);
  });

  it.each(devCases())("%s: every transcript turn is in the source, word for word", (id) => {
    const src = squash(read(id, "source.txt"));
    const parsed = parseTranscript(read(id, "transcript.txt"), { filename: "t.txt" });
    expect(parsed.unknownSpeakers).toEqual([]);
    for (const t of parsed.turns) expect(src.includes(squash(t.text)), `${id} ${t.label}`).toBe(true);
  });

  it.each(devCases())("%s: the turns appear in the source in the transcript's order", (id) => {
    const src = squash(read(id, "source.txt"));
    let from = 0;
    for (const t of parseTranscript(read(id, "transcript.txt"), { filename: "t.txt" }).turns) {
      const at = src.indexOf(squash(t.text), from);
      expect(at, `${id} ${t.label} is out of order`).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
  });

  it.each(devCases())("%s: every label names a real turn and cites the authority", (id) => {
    const turns = new Set(parseTranscript(read(id, "transcript.txt"), { filename: "t.txt" }).turns.map((t) => t.label));
    const { labels } = readJson<Labels>(id, "labels.json");
    expect(Array.isArray(labels)).toBe(true);
    for (const l of labels) {
      expect(turns.has(l.turn), `${id} ${l.turn}`).toBe(true);
      expect(l.authority_says).toBe("inside_information");
      expect(l.cite.trim().length, `${id} ${l.turn} cite`).toBeGreaterThan(0);
    }
    expect(new Set(labels.map((l) => l.turn)).size).toBe(labels.length);
  });

  it.each(devCases())("%s: packet and expert parse as a case", (id) => {
    const input = CreateCaseSchema.parse({ ...readJson<object>(id, "packet.json"), expert: readJson<object>(id, "expert.json") });
    expect(input.expert.name.length).toBeGreaterThan(1);
  });

  it("no sealed material is in the repository", () => {
    expect(readdirSync(REAL)).not.toContain("sealed");
  });
});
