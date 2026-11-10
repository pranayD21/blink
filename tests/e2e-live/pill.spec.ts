import { type Page, expect, test } from "@playwright/test";

const show = (page: Page, view: object) => page.evaluate((v) => new BroadcastChannel("blink-pill").postMessage(v), view);

test("the pill shows exactly what it is sent, and nothing else", async ({ page }) => {
  await page.goto("/desktop/pill");
  // The page sets this once its channel listener is attached; a message sent earlier would be lost.
  await expect(page.locator("main[data-ready=true]")).toHaveCount(1);
  for (const [level, text] of [
    ["listening", "Listening"],
    ["amber", "Getting close to inside information. Steer away."],
    ["red", "Sounds like inside information. Move on."],
    ["broken", "Blink can't hear the call."],
    ["ended", "Call ended. 3 passages hidden and sent to compliance."],
  ]) {
    await show(page, { level, text });
    await expect(page.getByTestId("pill")).toHaveText(text);
    await expect(page.getByTestId("pill")).toHaveAttribute("data-level", level);
    await expect(page.getByTestId("pill").locator("button, a, input")).toHaveCount(0);
    await expect(page.locator("button, a, input")).toHaveCount(0);
  }
  await show(page, { level: "idle", text: "" });
  await expect(page.getByTestId("pill")).toHaveCount(0);
  await expect(page.locator("button, a, input")).toHaveCount(0);
});
