/**
 * Loads `.env.local` (then `.env`) for processes Next.js does not start: the
 * worker and the scripts. Variables already set in the environment win, so
 * `BLINK_LLM_MODE=replay pnpm demo` overrides the file.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
