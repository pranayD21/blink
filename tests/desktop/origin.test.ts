import { describe, expect, it } from "vitest";
import { inOrigin, parseServer } from "../../desktop/src/origin";

describe("parseServer", () => {
  it("defaults to localhost:3000", () => {
    expect(parseServer(undefined)).toEqual({ url: "http://localhost:3000", origin: "http://localhost:3000" });
    expect(parseServer("  ")).toEqual({ url: "http://localhost:3000", origin: "http://localhost:3000" });
  });

  it("drops trailing slashes and keeps the origin", () => {
    expect(parseServer("https://blink.example.com//")).toEqual({
      url: "https://blink.example.com",
      origin: "https://blink.example.com",
    });
  });

  it("gives a one-line reason for a malformed address", () => {
    expect(() => parseServer("not a url")).toThrow('"not a url" is not a URL');
    expect(() => parseServer("file:///etc/passwd")).toThrow("must start with http:// or https://");
  });
});

describe("inOrigin", () => {
  const origin = "https://blink.example.com";

  it("accepts only the same scheme, host and port", () => {
    expect(inOrigin(origin, "https://blink.example.com/desktop")).toBe(true);
    expect(inOrigin(origin, "http://blink.example.com/desktop")).toBe(false);
    expect(inOrigin(origin, "https://blink.example.com:8443/")).toBe(false);
    expect(inOrigin(origin, "https://blink.example.com.evil.test/")).toBe(false);
    expect(inOrigin(origin, "https://blink.example.com@evil.test/")).toBe(false);
  });

  it("refuses what cannot be parsed or has no origin", () => {
    expect(inOrigin(origin, "")).toBe(false);
    expect(inOrigin(origin, "not a url")).toBe(false);
    expect(inOrigin(origin, "data:text/html,hi")).toBe(false);
    expect(inOrigin(origin, "about:blank")).toBe(false);
  });
});
