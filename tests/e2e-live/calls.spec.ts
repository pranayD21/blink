/**
 * The observability screens (spec section 8): one call read top to bottom, one moment opened into
 * its steps, and the overview of every call. They read the call `call.spec.ts` made, which runs
 * first in the same database (files run in name order on one worker). Run alone, this file makes
 * that call itself first.
 */
import { type Page, expect, test } from "@playwright/test";

async function actAs(page: Page, userId: "user_priya" | "user_marcus" | "user_jordan" | "user_dana", name: string) {
  // The role switcher lives in the app header, so start from a page that has one.
  if (page.url() === "about:blank") await page.goto("/");
  await page.getByTestId("role-switcher").click();
  await page.getByTestId(`act-as-${userId}`).click();
  await expect(page.getByTestId("current-user")).toHaveText(name);
}

/** Switches user through the API, for setup only: the tests themselves switch with the header's role switcher. */
const switchTo = (page: Page, userId: string) => page.request.post("/api/session/act-as", { data: { userId }, headers: { "Idempotency-Key": crypto.randomUUID() } });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  expect((await switchTo(page, "user_marcus")).ok()).toBe(true);
  const overview = (await (await page.request.get("/api/calls")).json()) as { recent: unknown[] };
  if (overview.recent.length === 0) {
    // The scripted Halvorsen call, as call.spec.ts plays it.
    expect((await switchTo(page, "user_priya")).ok()).toBe(true);
    await page.goto("/desktop?source=script&pace=150");
    await page.getByTestId("start-call-case_halvorsen").click();
    await expect(page.getByTestId("call-ended")).toBeVisible({ timeout: 60_000 });
  }
  await page.close();
});

test("one call reads top to bottom, and the red moment opens into its steps", async ({ page }) => {
  await actAs(page, "user_marcus", "Marcus Lee");
  await page.goto("/calls"); await page.locator('[data-testid^="call-link-"]').first().click();
  await expect(page.getByTestId("call-counts")).toContainText("Turns heard"); await expect(page.getByTestId("stage-hearing")).toHaveAttribute("data-ok", "true");
  const red = page.locator('[data-testid^="moment-"][data-level="red"]').first(); await red.click();
  await expect(page.getByTestId("step-Read")).toContainText("claude-haiku-5-5"); await expect(page.getByTestId("step-Rules checked")).toContainText("By code, not a model");
  await expect(page.getByTestId("step-Shown")).toContainText("Sounds like inside information. Move on.");
});
test("the overview leads with the typical time from words to warning", async ({ page }) => {
  await actAs(page, "user_dana", "Dana Okafor"); await page.goto("/calls");
  await expect(page.getByTestId("hero-latency")).toHaveText(/^(\d+\.\d s|—)$/); await expect(page.getByTestId("hero-caption")).toContainText("19 in 20");
  await expect(page.getByTestId("stage-row").locator("[data-ok]")).toHaveCount(5);
});
test("a banker cannot open either screen", async ({ page }) => { await actAs(page, "user_priya", "Priya Raman"); await page.goto("/calls"); await expect(page.getByTestId("role-gate")).toBeVisible(); });
test("neither a banker nor the policy owner can open one call", async ({ page }) => {
  expect((await switchTo(page, "user_marcus")).ok()).toBe(true);
  const { recent } = (await (await page.request.get("/api/calls")).json()) as { recent: { callId: string }[] };
  await page.goto("/");
  for (const [userId, name] of [["user_priya", "Priya Raman"], ["user_dana", "Dana Okafor"]] as const) {
    await actAs(page, userId, name); await page.goto(`/calls/${recent[0].callId}`);
    await expect(page.getByTestId("role-gate")).toBeVisible();
    await expect(page.locator("text=/orders fell|dashboard/i")).toHaveCount(0);
  }
});
test("the case under review links to its call record", async ({ page }) => {
  await actAs(page, "user_marcus", "Marcus Lee"); await page.goto("/cases/case_halvorsen");
  await page.getByTestId("link-call-record").click();
  await expect(page.getByTestId("call-counts")).toContainText("Turns heard");
});
