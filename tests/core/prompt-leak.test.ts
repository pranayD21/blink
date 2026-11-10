import { describe, expect, it } from "vitest";
import { fiveGrams, fixtureSources, promptSources } from "../helpers/prompt-leak";

/**
 * Five-word runs a prompt may share with a fixture. Each entry needs a comment
 * saying why the phrase cannot be avoided.
 */
const ALLOWED = new Set<string>([]);

describe("prompt leak", () => {
  it("finds the fixtures and the prompts", () => {
    expect(fixtureSources().length).toBeGreaterThanOrEqual(12);
    expect(promptSources().every((p) => fiveGrams(p).size > 0)).toBe(true);
  });

  // Any run of five consecutive words shared by a prompt and a fixture is a leak.
  it.each(promptSources().map((p, i) => [i, p] as const))("prompt %i shares no five-word run with the fixtures", (_i, prompt) => {
    const grams = fiveGrams(prompt);
    for (const src of fixtureSources()) for (const g of fiveGrams(src)) expect(grams.has(g) && !ALLOWED.has(g) ? g : null).toBeNull();
  });
});
