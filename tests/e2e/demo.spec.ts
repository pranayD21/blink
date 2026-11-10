/**
 * The demo script (§19), step by step, in replay mode. It asserts the visible
 * text of each key moment: COMPILE_FAILED, ACTIVE, the NEEDS_CONTEXT →
 * REVIEW_REQUIRED path, the mismatch reasons, the release failure checklist,
 * the release, and the analyst view.
 */
import { type Page, expect, test } from "@playwright/test";

const CASE = "/cases/case_halvorsen";
const RATIONALE = "Reviewed the linked passages against the policy and the public record.";

async function actAs(page: Page, userId: "user_priya" | "user_marcus" | "user_jordan" | "user_dana", name: string) {
  await page.getByTestId("role-switcher").click();
  await page.getByTestId(`act-as-${userId}`).click();
  await expect(page.getByTestId("current-user")).toHaveText(name);
}

/** Waits for a background job shown on the page to finish and the page to reload its data. */
async function jobDone(page: Page) {
  await expect(page.getByTestId("job-progress")).toHaveCount(0, { timeout: 90_000 });
}

async function selectFinding(page: Page, label: string) {
  await page.getByTestId(`finding-${label}`).click();
  await expect(page.getByTestId("evidence-label")).toHaveText(label);
}

async function dispose(page: Page, label: string, outcome: string) {
  await selectFinding(page, label);
  await page.getByTestId("outcome-select").selectOption(outcome);
  await page.getByTestId("rationale").fill(RATIONALE);
  await page.getByTestId("submit-dispose").click();
  await expect(page.getByTestId(`finding-${label}`)).toHaveAttribute("data-state", "DISPOSITIONED");
}

async function attest(page: Page) {
  await page.getByTestId("open-attest").click();
  await page.getByTestId("confirm-attest").click();
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-state", "READY_FOR_APPROVAL");
}

async function draftApproveRelease(page: Page, version: number) {
  await page.getByTestId("draft-ai").click();
  await jobDone(page);
  await expect(page.getByTestId("brief-status")).toHaveAttribute("data-state", "draft");
  await expect(page.getByText(`Brief v${version}`, { exact: false }).first()).toBeVisible();
  await page.getByTestId("open-approve").click();
  await expect(page.getByTestId("approve-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByTestId("confirm-approve").click();
  await expect(page.getByTestId("brief-status")).toHaveAttribute("data-state", "approved");
  await page.getByTestId("release").click();
  await expect(page.getByTestId("release-success")).toBeVisible();
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-state", "RELEASED");
}

test("the demo script runs end to end from recordings", async ({ page, baseURL }) => {
  // The demo must not depend on the network: the browser may only ever talk to the app itself.
  const appHost = new URL(baseURL!).host;
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== appHost) outside.push(request.url());
  });

  // ── 1. The queue ──────────────────────────────────────────────────────────
  await test.step("1. queue with one case and the synthetic-data pill", async () => {
    await page.goto("/");
    await expect(page.getByTestId("synthetic-pill")).toHaveText("Synthetic data");
    await expect(page.getByTestId("case-row-case_halvorsen")).toContainText("Halvorsen Pumps");
    await expect(page.getByTestId("no-policy-banner")).toBeVisible();
  });

  // ── 2. A bad compile can never go live ────────────────────────────────────
  await test.step("2. the broken policy ends COMPILE_FAILED and cannot be approved", async () => {
    await actAs(page, "user_dana", "Dana Okafor");
    await page.goto("/policies/new");
    await page.getByTestId("preset-Broken variant").click();
    await page.getByTestId("create-and-compile").click();
    await expect(page.getByTestId("policy-status")).toHaveAttribute("data-state", "COMPILE_FAILED", { timeout: 90_000 });
    await expect(page.getByTestId("compile-failed-banner")).toContainText("CLAUSE_DROPPED");
    await page.getByTestId("tab-approve").click();
    await expect(page.getByTestId("approve-policy")).toBeDisabled();
    await expect(page.getByTestId("approve-disabled-reason")).toContainText("blocking");
  });

  // ── 3. Compile, validate, approve by hash ─────────────────────────────────
  await test.step("3. policy v1 compiles, validates, and is approved by hash", async () => {
    await page.goto("/policies/new");
    await page.getByTestId("preset-Demo policy v1").click();
    await page.getByTestId("create-and-compile").click();
    await expect(page.getByTestId("policy-status")).toHaveAttribute("data-state", "VALIDATED", { timeout: 90_000 });

    await page.getByTestId("tab-clauses").click();
    await expect(page.getByTestId("unsupported-P8")).toBeVisible();
    await page.getByTestId("tab-monitors").click();
    await expect(page.getByTestId("monitor-graph-M1")).toBeVisible();
    await page.getByTestId("tab-validation").click();
    await expect(page.getByTestId("enumeration-summary")).toContainText(/[\d,]+ evidence combinations checked across 4 monitors: deterministic, indeterminate always handled/);
    await page.getByTestId("tab-scenarios").click();
    await expect(page.getByTestId("reviewer-scenarios")).toHaveText("8/8 pass");

    await page.getByTestId("tab-approve").click();
    const hash = (await page.getByTestId("bundle-hash").innerText()).trim();
    await expect(page.getByTestId("approve-policy")).toBeDisabled();
    await page.getByTestId("approve-confirm").fill(hash.slice(0, 6));
    await page.getByTestId("approve-policy").click();
    await expect(page.getByTestId("policy-status")).toHaveAttribute("data-state", "ACTIVE");
  });

  // ── 4. The analyst uploads the transcript ─────────────────────────────────
  await test.step("4. the analyst uploads transcript v1 and analysis runs", async () => {
    await actAs(page, "user_priya", "Priya Raman");
    await page.goto(CASE);
    await page.getByTestId("sample-transcript-v1.txt").click();
    await expect(page.getByTestId("transcript-preview")).toContainText("22 turns");
    await page.getByTestId("upload-transcript-submit").click();
    await expect(page.getByTestId("job-progress")).toBeVisible();
    await jobDone(page);
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-state", "IN_REVIEW");
    // The analyst never sees findings.
    await expect(page.locator('[data-state="REVIEW_REQUIRED"]')).toHaveCount(0);
  });

  // ── 5. The reviewer opens F1 ──────────────────────────────────────────────
  await test.step("5. F1 links T5 and T11, with trace, history, escalation, and the public mismatch", async () => {
    await actAs(page, "user_marcus", "Marcus Lee");
    await page.goto(CASE);
    await expect(page.getByTestId("replayed-badge")).toContainText("Replayed from recorded run");
    await selectFinding(page, "F1");
    await expect(page.getByTestId("finding-F1")).toHaveAttribute("data-state", "REVIEW_REQUIRED");
    await expect(page.getByTestId("hidden-status")).toHaveText("Hidden from the banker until you decide");
    await expect(page.getByTestId("linked-badge-T5")).toContainText("linked to T11");
    await expect(page.getByTestId("linked-badge-T11")).toContainText("linked to T5");
    await expect(page.getByTestId("quote-T5")).toContainText("orders fell off a cliff");
    await expect(page.getByTestId("quote-T11").first()).toBeVisible();

    for (const rule of ["R1", "R2", "R4"]) await expect(page.getByTestId(`trace-${rule}`)).toHaveAttribute("data-state", "REVIEW_REQUIRED");
    await expect(page.getByTestId("fsm-path")).toContainText(/Unassessed.*Needs context\s*at T5.*Review required\s*at T11/s);
    await expect(page.getByTestId("escalation-notice")).toContainText("senior compliance officer");
    await expect(page.getByTestId("comparison-outcome")).toHaveText("mismatch");
    await expect(page.getByTestId("mismatch-reasons")).toContainText("period, scope");
  });

  // ── 6. Decisions are made by people ───────────────────────────────────────
  await test.step("6. clarification, dispositions, the escalation, and the attestation", async () => {
    // F3: the clarification moves the monitor, not the reviewer.
    await selectFinding(page, "F3");
    await expect(page.getByTestId("finding-F3")).toHaveAttribute("data-state", "NEEDS_CONTEXT");
    await page.getByTestId("clarification-answer").fill("Expert confirms it reflects Halvorsen's public Q1 earnings-call commentary.");
    await page.getByTestId("map-knowledge_basis").selectOption("public_source");
    await page.getByTestId("submit-clarification").click();
    await expect(page.getByTestId("finding-F3")).toHaveAttribute("data-state", "NOT_TRIGGERED_PENDING_ACK");
    await page.getByTestId("rationale").fill(RATIONALE);
    await page.getByTestId("submit-dispose").click();
    await expect(page.getByTestId("finding-F3")).toHaveAttribute("data-state", "DISPOSITIONED");

    await dispose(page, "F2", "restricted_exclude");

    // A reviewer cannot decide F1: the server refuses.
    await selectFinding(page, "F1");
    await page.getByTestId("outcome-select").selectOption("restricted_exclude");
    await page.getByTestId("rationale").fill(RATIONALE);
    await page.getByTestId("submit-dispose").click();
    await expect(page.getByTestId("action-error")).toContainText("only a senior reviewer can decide it");
    await expect(page.getByTestId("finding-F1")).toHaveAttribute("data-state", "REVIEW_REQUIRED");

    await actAs(page, "user_jordan", "Jordan Ellis");
    await dispose(page, "F1", "restricted_escalate_to_legal");

    // AI-suggested concerns are labeled and need a person's decision too.
    await expect(page.getByTestId("ai-suggested-header")).toContainText("AI-suggested");
    const aiLabels = await page.locator('[data-testid^="finding-F"][data-state="REVIEW_REQUIRED"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("finding-", "")));
    for (const label of aiLabels) await dispose(page, label, "no_concern");

    await actAs(page, "user_marcus", "Marcus Lee");
    await attest(page);
  });

  // ── 7. Brief: draft, approve the hash, release ────────────────────────────
  await test.step("7. the brief is drafted from eligible claims, approved, released, and visible to the analyst", async () => {
    await page.getByTestId("link-brief").click();
    await expect(page).toHaveURL(/\/brief$/);
    await draftApproveRelease(page, 1);
    await expect(page.getByTestId("withheld-note")).toHaveText("2 statements withheld by compliance.");

    await actAs(page, "user_priya", "Priya Raman");
    await page.goto("/analyst");
    const brief = page.getByTestId("released-brief").first();
    await expect(brief).toHaveAttribute("data-standing", "current");
    await expect(brief.getByTestId("withheld-note")).toHaveText("2 statements withheld by compliance.");
    await expect(brief.locator('[data-testid^="citation-"]').first()).toBeVisible();
    // Neither restricted statement reaches the analyst.
    await expect(brief).not.toContainText("Cardinal");
    await expect(brief).not.toContainText("dashboard");
    await brief.locator('[data-testid^="citation-"]').first().click();
    await expect(brief.locator("aside")).toContainText("“");
  });

  // ── 8. Evidence changes; only what depended on it reopens ─────────────────
  await test.step("8. transcript v2 makes the approval and the attestation stale, and nothing else", async () => {
    await actAs(page, "user_marcus", "Marcus Lee");
    await page.goto(CASE);
    await page.getByTestId("open-upload").click();
    await page.getByTestId("sample-transcript-v2.txt").click();
    await expect(page.getByTestId("transcript-preview")).toContainText("22 turns");
    await page.getByTestId("upload-transcript-submit").click();
    await jobDone(page);
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-state", "IN_REVIEW");
    await expect(page.getByTestId("turn-T19")).toContainText("edited in v2");
    await expect(page.getByTestId("turn-T19")).toContainText("twenty-one percent");

    // F1–F3 decisions are still valid.
    for (const label of ["F1", "F2", "F3"]) await expect(page.getByTestId(`finding-${label}`)).toHaveAttribute("data-state", "DISPOSITIONED");
    await selectFinding(page, "F1");
    await expect(page.getByTestId("decision").first()).toHaveAttribute("data-stale", "false");

    await page.getByTestId("link-brief").click();
    await expect(page.getByTestId("brief-status")).toHaveAttribute("data-state", "stale");
    await expect(page.getByTestId("approval-status")).toContainText("Approval STALE");
    await page.getByTestId("release").click();
    const failures = page.getByTestId("release-failures");
    await expect(failures).toContainText(/approval stale: claim changed \(C\d+ · T19\)/);
    await expect(failures).toContainText("attestation stale: transcript v2");
  });

  // ── 9. Re-attest, re-approve, release ─────────────────────────────────────
  await test.step("9. after re-attesting and approving a new version, release succeeds and the audit chain verifies", async () => {
    await page.goto(CASE);
    await attest(page);
    await page.getByTestId("link-brief").click();
    await draftApproveRelease(page, 2);
    await expect(page.getByTestId("brief-body")).toContainText("twenty-one percent");

    await page.goto(`${CASE}/audit`);
    await page.getByTestId("verify-chain").click();
    await expect(page.getByTestId("verify-ok")).toContainText("Verify chain ✓");

    await actAs(page, "user_priya", "Priya Raman");
    await page.goto("/analyst");
    await expect(page.getByTestId("released-brief")).toHaveCount(2);
    await expect(page.getByTestId("released-brief").first()).toHaveAttribute("data-standing", "current");
    await expect(page.getByTestId("superseded-banner")).toBeVisible();
  });

  // ── 10. Metrics ───────────────────────────────────────────────────────────
  await test.step("10. the metrics page shows the target, measured review time, cost, and the eval table", async () => {
    await page.goto("/metrics");
    await expect(page.getByTestId("synthetic-note")).toContainText("They are not production accuracy");
    await expect(page.getByTestId("pilot-target")).toContainText("30% less review time");
    await expect(page.getByTestId("pilot-target")).toContainText("43% more calls");
    await expect(page.getByTestId("eval-table")).toContainText("Halvorsen");
    await expect(page.getByTestId("missed-none")).toBeVisible();
  });

  expect(outside, "requests the browser made to hosts other than the app").toEqual([]);
});
