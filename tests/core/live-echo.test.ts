import { describe, expect, it } from "vitest";
import { isEchoOf } from "@/core/live/echo";

describe("isEchoOf", () => {
  it("is true when the microphone repeats the far side", () =>
    expect(isEchoOf("orders fell off a cliff they are down", "Honestly, orders fell off a cliff. They're down about twenty percent.")).toBe(true));
  it("is false for something else", () => expect(isEchoOf("how is demand looking", "Honestly, orders fell off a cliff.")).toBe(false));
  it("is never true under three words", () => expect(isEchoOf("yes", "yes")).toBe(false));
  it("ignores case and punctuation", () => expect(isEchoOf("Orders, FELL off!", "orders fell off")).toBe(true));
  it("needs at least 80% of the words", () => {
    expect(isEchoOf("one two three four five", "one two three four")).toBe(true);
    expect(isEchoOf("one two three four five six", "one two three four")).toBe(false);
  });
});
