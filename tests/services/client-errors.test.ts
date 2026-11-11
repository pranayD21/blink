import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/client-errors/route";
import { clientErrorLine } from "@/server/http/client-error";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost/api/client-errors", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("clientErrorLine", () => {
  it("writes one line with the path, the boundary, the name and the message", () => {
    const line = clientErrorLine({ path: "/cases", boundary: "global", name: "TypeError", message: "x is undefined", digest: "123" }, "Chrome");
    expect(line).toBe('[client-error] path=/cases boundary=global name=TypeError message="x is undefined" digest=123 ua="Chrome"');
  });

  it("keeps a report on one line, so it cannot forge another", () => {
    const line = clientErrorLine({ message: "a\nb\r\n[client-error] forged", stack: "at f\nat g" }, null)!;
    expect(line.split("\n")).toHaveLength(1);
    expect(line).not.toMatch(/[\r\n]/);
  });

  it("cuts long fields short", () => {
    const line = clientErrorLine({ message: "m".repeat(5000) }, null)!;
    expect(line.length).toBeLessThan(400);
  });

  it("refuses a report with no message", () => {
    expect(clientErrorLine({ path: "/" }, null)).toBeNull();
    expect(clientErrorLine([], null)).toBeNull();
    expect(clientErrorLine(null, null)).toBeNull();
  });
});

describe("POST /api/client-errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a report and answers 204 with no body", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ message: "boom", path: "/cases" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[client-error\] path=\/cases .*message="boom"/));
  });

  it("refuses another site, an oversized report and a malformed one, and logs none of them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ message: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ message: "x".repeat(5000) })).status).toBe(413);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ nothing: true })).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
});
