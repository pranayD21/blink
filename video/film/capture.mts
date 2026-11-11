import { chromium, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const B = "http://localhost:3283", D = "https://blink-production.up.railway.app", OUT = "video/film/public/shots";
const CASE = B + "/cases/case_halvorsen", RAT = "Checked the linked quotes against the policy and the public record.";
const rects: Record<string, Record<string, number[]>> = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
const p = await ctx.newPage();
const clean = () => p.addStyleTag({ content: `[data-testid=llm-mode],[data-testid=replayed-badge]{display:none!important} *{caret-color:transparent!important}` });
async function shot(name: string, targets: Record<string, string> = {}) {
  await clean(); await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  rects[name] = {};
  for (const [k, sel] of Object.entries(targets)) {
    const b = await p.locator(sel).first().boundingBox().catch(() => null);
    if (b) rects[name][k] = [b.x / 1600, b.y / 900, b.width / 1600, b.height / 900];
    else console.log("missing", name, k);
  }
  console.log("shot", name, Object.keys(rects[name]).join(","));
}
const T = (id: string) => p.getByTestId(id);
const as = async (id: string) => { await T("role-switcher").click(); await T(`act-as-${id}`).click(); await p.waitForTimeout(1000); };
const st = (id: string) => T(id).getAttribute("data-state").catch(() => null);
const until = async (f: () => Promise<boolean>, ms = 180000) => { const t = Date.now(); while (!(await f())) { if (Date.now() - t > ms) throw new Error("timeout"); await p.waitForTimeout(300); } };
const fs = (l: string) => T(`finding-${l}`).getAttribute("data-state");
async function dispose(l: string, o: string) { await T(`finding-${l}`).click(); await T("outcome-select").selectOption(o); await T("rationale").fill(RAT); await T("submit-dispose").click(); await until(async () => (await fs(l)) === "DISPOSITIONED", 20000); }

await p.goto(B + "/cases", { waitUntil: "networkidle" }); await as("user_dana");
await p.goto(B + "/policies/new", { waitUntil: "networkidle" });
await T("preset-Demo policy v1").click(); await p.waitForTimeout(400);
await shot("policy-new", { text: "[data-testid=policy-text]" });
await T("create-and-compile").click(); await until(async () => (await st("policy-status")) === "VALIDATED");
await T("tab-clauses").click(); await shot("policy-clauses");
await T("tab-monitors").click(); await shot("policy-monitors", { graph: "[data-testid=monitor-graph-M1]" });
await T("tab-validation").click(); await shot("policy-validation", { summary: "[data-testid=enumeration-summary]" });
await T("tab-scenarios").click(); await shot("policy-scenarios", { pass: "[data-testid=reviewer-scenarios]" });
await T("tab-approve").click();
const hash = (await T("bundle-hash").innerText()).trim();
await T("approve-confirm").fill(hash.slice(0, 6)); await T("approve-policy").click();
await until(async () => (await st("policy-status")) === "ACTIVE", 30000);
await p.waitForTimeout(5000); await shot("policy-active", { status: "[data-testid=policy-status]", hash: "[data-testid=bundle-hash]" });

await as("user_priya"); await p.goto(CASE, { waitUntil: "networkidle" });
await T("sample-transcript-v1.txt").click(); await T("upload-transcript-submit").click();
await until(async () => (await st("case-status")) === "IN_REVIEW");
await as("user_marcus"); await p.goto(B + "/cases", { waitUntil: "networkidle" }); await shot("queue", { row: "[data-testid=case-row-case_halvorsen]" });
await p.goto(CASE, { waitUntil: "networkidle" }); await T("finding-F1").click(); await p.waitForTimeout(800);
await shot("review-f1", { f1: "[data-testid=finding-F1]", findings: "[data-testid=findings-pane]", t5: "[data-testid=quote-T5]", t11: "[data-testid=quote-T11]", fsm: "[data-testid=fsm-path]", hidden: "[data-testid=hidden-status]", turn5: "[data-testid=turn-T5]" });
await T("trace-R1").scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
await shot("review-trace", { r1: "[data-testid=trace-R1]", r2: "[data-testid=trace-R2]" });
await T("comparison-outcome").scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
await shot("review-public", { outcome: "[data-testid=comparison-outcome]", reasons: "[data-testid=mismatch-reasons]" });

await T("finding-F3").click(); await T("clarification-answer").fill("Expert confirms it reflects Halvorsen's public Q1 earnings-call commentary.");
await T("map-knowledge_basis").selectOption("public_source"); await T("submit-clarification").click();
await until(async () => (await fs("F3")) === "NOT_TRIGGERED_PENDING_ACK", 20000);
await T("rationale").fill(RAT); await T("submit-dispose").click(); await until(async () => (await fs("F3")) === "DISPOSITIONED", 20000);
await dispose("F2", "restricted_exclude");
await as("user_jordan"); await dispose("F1", "restricted_escalate_to_legal");
for (const l of await p.locator('[data-testid^="finding-F"][data-state="REVIEW_REQUIRED"]').evaluateAll((e) => e.map((x) => x.getAttribute("data-testid")!.replace("finding-", "")))) await dispose(l, "no_concern");
await as("user_marcus"); await T("open-attest").click(); await T("confirm-attest").click(); await until(async () => (await st("case-status")) === "READY_FOR_APPROVAL", 20000);
await p.waitForTimeout(4500); await shot("review-done", { findings: "[data-testid=findings-pane]" });
await T("link-brief").click(); await p.waitForURL(/brief$/); await p.waitForTimeout(800);
await T("draft-ai").click(); await until(async () => (await T("job-progress").count()) === 0 && (await st("brief-status")) === "draft");
await p.waitForTimeout(800); await shot("brief-draft", { body: "[data-testid=brief-body]", cite: "[data-testid=brief-body] [data-testid^=citation-]", eligible: "[data-testid=eligibility]" });
await T("open-approve").click(); await p.waitForTimeout(700); await shot("brief-approve", { hash: "[data-testid=approve-hash]" });
await T("confirm-approve").click(); await until(async () => (await st("brief-status")) === "approved", 20000);
await T("release").click(); await T("release-success").waitFor({ timeout: 30000 }); await p.waitForTimeout(4500);
await shot("brief-released", { success: "[data-testid=release-success]", withheld: "[data-testid=withheld-note]" });
await p.goto(CASE + "/audit", { waitUntil: "networkidle" }); await T("verify-chain").click(); await T("verify-ok").waitFor({ timeout: 20000 }); await shot("audit", { ok: "[data-testid=verify-ok]" });
await p.goto(B + "/metrics", { waitUntil: "networkidle" }); await shot("metrics");
await as("user_priya"); await p.goto(B + "/analyst", { waitUntil: "networkidle" });
const brief = T("released-brief").first(); await brief.locator('[data-testid^="citation-"]').first().click(); await p.waitForTimeout(800);
await shot("banker-brief", { brief: "[data-testid=released-brief]", aside: "[data-testid=released-brief] aside" });
await brief.getByTestId("read-transcript").click(); await T("hidden-count").waitFor(); await p.waitForTimeout(600);
await shot("banker-transcript", { count: "[data-testid=hidden-count]", bar: "[data-testid=hidden-bar]" });
await T("hidden-bar").nth(1).scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await p.mouse.wheel(0, 380); await p.waitForTimeout(700);
await shot("banker-transcript2", { bar: "[data-testid=hidden-bar]" });

// Real observability, from the deployed app.
const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("BLINK_SEED_PASSWORDS="))!;
const pw = JSON.parse(line.slice(line.indexOf("=") + 1).replace(/^'|'$/g, "")).user_marcus as string;
const c2 = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
const q = await c2.newPage();
await q.goto(D + "/login", { waitUntil: "networkidle" });
await q.getByTestId("login-email").fill("marcus@blink.demo"); await q.getByTestId("login-password").fill(pw); await q.getByTestId("login-submit").click();
await q.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await q.goto(D + "/calls", { waitUntil: "networkidle" }); await q.waitForTimeout(900); await q.screenshot({ path: `${OUT}/calls.png` });
await q.goto(D + "/calls/call_01M740R9XT5HN7KPZ1TVTC3AM1", { waitUntil: "networkidle" }); await q.waitForTimeout(900); await q.screenshot({ path: `${OUT}/call-record.png` });
writeFileSync("video/film/src-rects.json", JSON.stringify(rects, null, 1));
await browser.close();
