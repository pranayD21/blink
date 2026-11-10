import { describe, expect, it } from "vitest";
import { and, not, or, toTri } from "@/core/logic/kleene";
import type { Tri } from "@/core/types";

const T: Tri = "true";
const F: Tri = "false";
const I: Tri = "indeterminate";

describe("kleene three-valued logic", () => {
  it("maps the four evidence states", () => {
    expect(toTri("supported")).toBe(T);
    expect(toTri("refuted")).toBe(F);
    expect(toTri("unknown")).toBe(I);
    expect(toTri("conflict")).toBe(I);
  });

  // Rows: left operand. Columns: right operand, in order T, F, I.
  const AND: Record<Tri, Tri[]> = { true: [T, F, I], false: [F, F, F], indeterminate: [I, F, I] };
  const OR: Record<Tri, Tri[]> = { true: [T, T, T], false: [T, F, I], indeterminate: [T, I, I] };
  const values: Tri[] = [T, F, I];

  for (const a of values) {
    values.forEach((b, j) => {
      it(`and(${a}, ${b}) = ${AND[a][j]}`, () => expect(and([a, b])).toBe(AND[a][j]));
      it(`or(${a}, ${b}) = ${OR[a][j]}`, () => expect(or([a, b])).toBe(OR[a][j]));
    });
  }

  it("not swaps true and false and keeps indeterminate", () => {
    expect(not(T)).toBe(F);
    expect(not(F)).toBe(T);
    expect(not(I)).toBe(I);
  });

  it("a single false decides and; a single true decides or, whatever else is unknown", () => {
    expect(and([I, I, F, T])).toBe(F);
    expect(or([I, F, T, I])).toBe(T);
    expect(and([T, T, T])).toBe(T);
    expect(or([F, F, F])).toBe(F);
  });
});
