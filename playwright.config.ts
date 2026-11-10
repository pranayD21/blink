import { defineConfig, devices } from "@playwright/test";

/**
 * The demo script (§19) end to end, in replay mode: a fresh database, a
 * production build, the worker, and recorded model responses. No network.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1500, height: 950 } } }],
  webServer: {
    command: "pnpm e2e:serve",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
