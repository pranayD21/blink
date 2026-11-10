import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files and folders held to the look rules: theme tokens only, no capital-letter styling. Later tasks extend this list. */
export const UI_RULE_SCOPE: string[] = ["src/components/app", "src/app/layout.tsx", "src/components/live", "src/app/desktop", "src/app/analyst/[releaseId]", "src/components/brief/released-transcript.tsx", "src/app/calls", "src/components/calls", "src/app/page.tsx", "src/app/cases/new", "src/components/cases", "src/components/ui", "src/app/analyst", "src/components/workspace", "src/app/cases/[id]/page.tsx", "src/components/brief/released-brief.tsx"];

/** Every .ts and .tsx file under the given paths (a folder is walked recursively, a file is taken as it is). */
export function filesIn(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else if (/\.tsx?$/.test(path)) {
      out.push(path);
    }
  };
  for (const p of paths) walk(p);
  return out;
}
