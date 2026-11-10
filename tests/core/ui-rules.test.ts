import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UI_RULE_SCOPE, filesIn } from "../helpers/ui-scope";

const FORBIDDEN = [/\buppercase\b/, /\b(?:bg|text|border|ring|decoration)-(?:white|black|(?:slate|indigo|sky|violet|amber|red|emerald|gray|zinc)-\d{2,3})\b/];

describe("look rules", () => {
  it("covers at least the app components and the layout", () => {
    expect(filesIn(UI_RULE_SCOPE).length).toBeGreaterThan(5);
  });
  it.each(filesIn(UI_RULE_SCOPE))("%s uses theme tokens only and no capitals", (file) => {
    const text = readFileSync(file, "utf8");
    for (const rule of FORBIDDEN) expect(text.match(rule)?.[0] ?? null, file).toBeNull();
  });
});
