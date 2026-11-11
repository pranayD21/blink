/**
 * The guided trial ("Walk me through a trial") reaches its last step for every role, without a
 * page error and without a click that changes nothing. A stuck step, or one with nothing to point
 * at, once crashed the page or looped forever.
 */
import { type Page, expect, test } from "@playwright/test";

const USERS = [
  ["user_priya", "Priya Raman"],
  ["user_marcus", "Marcus Lee"],
  ["user_dana", "Dana Okafor"],
] as const;

async function walkTrial(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("start-trial").click();
  let last = "";
  for (let i = 0; i < 30; i++) {
    const card = page.getByTestId("trial-card");
    if ((await card.count()) === 0) break;
    await expect(page.getByTestId("trial-next")).toBeVisible();
    await page.waitForTimeout(500);
    const now = `${page.url()} ${await card.getAttribute("data-step")} ${await card.locator("p").nth(1).textContent()}`;
    expect(now, "a trial click changed nothing").not.toBe(last);
    last = now;
    await page.getByTestId("trial-next").click();
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByTestId("trial-card")).toHaveCount(0);
  await expect(page.getByText(/hit a problem|couldn.t load/i)).toHaveCount(0);
  expect(errors).toEqual([]);
}

for (const [id, name] of USERS) {
  test(`the trial runs to the end as ${name}`, async ({ page }) => {
    await page.goto("/cases");
    await page.getByTestId("role-switcher").click();
    await page.getByTestId(`act-as-${id}`).click();
    await expect(page.getByTestId("current-user")).toHaveText(name);
    await walkTrial(page);
  });
}
