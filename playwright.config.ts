import { defineConfig, devices } from "@playwright/test";

/**
 * The demo script (§19) end to end, in replay mode. No network.
 *
 * By default the test starts its own server: a fresh database, a production
 * build, and the worker, on port 3100. Set BLINK_E2E_BASE_URL to run the same
 * test against a server that is already up — `pnpm demo:offline` does this to
 * drive the real `pnpm demo` with the network disabled. That server must be on
 * a freshly reset database.
 */
const external = process.env.BLINK_E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://localhost:3100",
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1500, height: 950 } } }],
  webServer: external
    ? undefined
    : {
        command: "pnpm e2e:serve",
        url: "http://localhost:3100",
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
