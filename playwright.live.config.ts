import { defineConfig, devices } from "@playwright/test";

/**
 * Live-guidance browser tests, in replay mode. No network.
 *
 * Starts its own server on port 3101: a fresh database with the manual policy
 * active, a production build, and the worker. It builds into the same `.next`
 * folder as the demo config, so `pnpm e2e` runs the two configs one after the
 * other and never together. Set BLINK_E2E_BASE_URL to use a server that is
 * already up.
 */
const external = process.env.BLINK_E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e-live",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://localhost:3101",
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1500, height: 950 } } }],
  webServer: external
    ? undefined
    : {
        command: "pnpm e2e:serve:live",
        url: "http://localhost:3101",
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
