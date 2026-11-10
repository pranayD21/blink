import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/core/**/*.test.ts", "tests/services/**/*.test.ts", "tests/desktop/**/*.test.ts"],
    environment: "node",
    // Unit and service tests must never reach the network (§18.1).
    // Tests act as demo users through the switcher; the sign-in tests switch to password mode themselves.
    env: { BLINK_LLM_MODE: "replay", BLINK_DB_PATH: ":memory:", BLINK_AUTH_MODE: "switcher" },
  },
});
