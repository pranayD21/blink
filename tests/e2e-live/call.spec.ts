/**
 * A whole call from the banker's control page, in replay mode: the scripted Halvorsen turns go
 * through the real call session and the real server, and the reader's answers replay from the
 * recordings `pnpm record:live` made. The pill page hears every view on the `blink-pill` channel.
 */
import { type Page, expect, test } from "@playwright/test";

async function actAs(page: Page, userId: "user_priya" | "user_marcus" | "user_jordan" | "user_dana", name: string) {
  // The role switcher lives in the app header, so start from a page that has one.
  if (page.url() === "about:blank") await page.goto("/");
  await page.getByTestId("role-switcher").click();
  await page.getByTestId(`act-as-${userId}`).click();
  await expect(page.getByTestId("current-user")).toHaveText(name);
}

test("a scripted call turns the pill red at the source remark and ends with a count", async ({ page, context }) => {
  await actAs(page, "user_priya", "Priya Raman");
  const pill = await context.newPage(); await pill.goto("/desktop/pill");
  await page.goto("/desktop?source=script&pace=150");
  await page.getByTestId("start-call-case_halvorsen").click();
  await expect(pill.getByTestId("pill")).toHaveAttribute("data-level", "red", { timeout: 30_000 });
  await expect(page.getByTestId("call-ended")).toBeVisible({ timeout: 60_000 });
  await expect(pill.getByTestId("pill")).toHaveText(/^Call ended\. \d+ passages? hidden and sent to compliance\.$/);
  await expect(page.locator("text=/orders fell|dashboard/i")).toHaveCount(0);       // the banker sees no transcript
});
