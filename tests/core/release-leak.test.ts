import { describe, expect, it } from "vitest";
import { findLeaks, spellNumber } from "@/core/release/leak";

const hidden = [{ label: "F1 · T5", text: "They're down about twenty percent in the West region.", numbers: [20], names: ["West region"] }];
const none = { numbers: new Set<number>(), names: new Set<string>() };

describe("spelling numbers", () => {
  it("spells whole numbers 0 to 100 and nothing else", () => {
    expect(spellNumber(0)).toBe("zero");
    expect(spellNumber(20)).toBe("twenty");
    expect(spellNumber(21)).toBe("twenty-one");
    expect(spellNumber(100)).toBe("one hundred");
    expect(spellNumber(101)).toBeNull();
    expect(spellNumber(-1)).toBeNull();
    expect(spellNumber(2.5)).toBeNull();
  });
});

describe("summary leak check", () => {
  it("five words in a row from a hidden passage is a quote leak", () => {
    const leaks = findLeaks(["Sources say they're down about twenty percent overall."], hidden, none);
    expect(leaks[0]).toMatchObject({ kind: "quote", passage: "F1 · T5", detail: "they re down about twenty percent" });
  });

  it("four words in a row is not a quote leak", () =>
    expect(findLeaks(["They're down about trends."], [{ ...hidden[0], numbers: [], names: [] }], none)).toEqual([]));

  it("a hidden figure, as digits or as a word, is a leak", () => {
    expect(findLeaks(["Bookings fell 20%."], hidden, none)[0].kind).toBe("figure");
    expect(findLeaks(["Bookings fell twenty percent."], hidden, none)[0].kind).toBe("figure");
    expect(findLeaks(["Bookings fell 20 percent."], hidden, none)[0]).toMatchObject({ kind: "figure", detail: "20" });
  });

  it("does not mistake neighbouring numbers for the hidden one", () => {
    expect(findLeaks(["Bookings fell 20.5%, or 120 units, or twenty-one cases."], [{ ...hidden[0], names: [] }], none)).toEqual([]);
  });

  it("a hyphenated spelled number matches as a phrase", () => {
    const h = [{ label: "F2", text: "x", numbers: [21], names: [] }];
    expect(findLeaks(["Down twenty-one percent."], h, none)[0].kind).toBe("figure");
    expect(findLeaks(["Down twenty percent."], h, none)).toEqual([]);
  });

  it("the same figure is not a leak when a visible statement also carries it", () =>
    expect(findLeaks(["Prices rose 20%."], hidden, { numbers: new Set([20]), names: new Set() })).toEqual([]));

  it("a name that appears only in hidden passages is a leak", () =>
    expect(findLeaks(["The West region was weak."], hidden, none)[0]).toEqual({ passage: "F1 · T5", kind: "name", detail: "West region" }));

  it("a name matches whole words only, and not when it is visible", () => {
    expect(findLeaks(["The Westregion team met."], hidden, none)).toEqual([]);
    expect(findLeaks(["The west region was weak."], hidden, { numbers: new Set(), names: new Set(["West Region"]) })).toEqual([]);
  });

  it("reports each leak once per passage, kind and detail", () => {
    const leaks = findLeaks(["Down 20%.", "Again 20%, twenty."], hidden, none);
    expect(leaks.filter((l) => l.kind === "figure")).toHaveLength(1);
  });

  it("a clean summary has no leaks", () =>
    expect(findLeaks(["Distributors are working through inventory."], hidden, none)).toEqual([]));
});
