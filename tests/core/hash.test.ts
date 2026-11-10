import { describe, expect, it } from "vitest";
import { canonicalJson, claimHash, evidenceHash, hashOf, sha256Hex } from "@/core/deps/hash";

describe("canonical JSON and hashing", () => {
  it("orders object keys, at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("is independent of insertion order", () => {
    expect(hashOf({ x: 1, y: [1, 2], z: "s" })).toBe(hashOf({ z: "s", y: [1, 2], x: 1 }));
  });

  it("drops undefined members and keeps array order", () => {
    expect(canonicalJson({ a: undefined, b: [2, 1] })).toBe('{"b":[2,1]}');
  });

  it("changes when one character changes", () => {
    const a = sha256Hex("hot-rolled is up about twelve percent");
    const b = sha256Hex("hot-rolled is up about twelvE percent");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a known SHA-256 vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("rejects non-finite numbers rather than hashing them as null", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  it("claim hash ignores quote order but not quote offsets", () => {
    const q1 = { turnTextHash: "aa", start: 0, end: 5, role: "primary" };
    const q2 = { turnTextHash: "bb", start: 3, end: 9, role: "context" };
    const base = claimHash({ fields: { a: 1 }, verified: null, quotes: [q1, q2] });
    expect(claimHash({ fields: { a: 1 }, verified: null, quotes: [q2, q1] })).toBe(base);
    expect(claimHash({ fields: { a: 1 }, verified: null, quotes: [q1, { ...q2, end: 10 }] })).not.toBe(base);
    expect(claimHash({ fields: { a: 1 }, verified: { a: 2 }, quotes: [q1, q2] })).not.toBe(base);
  });

  it("evidence hash is order-independent over dependency edges", () => {
    const e1 = { sourceType: "turn", sourceId: "t1", sourceHash: "h1" };
    const e2 = { sourceType: "claim", sourceId: "c1", sourceHash: "h2" };
    expect(evidenceHash([e1, e2])).toBe(evidenceHash([e2, e1]));
    expect(evidenceHash([e1, e2])).not.toBe(evidenceHash([e1, { ...e2, sourceHash: "h3" }]));
  });
});
