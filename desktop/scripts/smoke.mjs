// Runs the packaged app with --smoke and checks the one JSON line it prints.
// ELECTRON_RUN_AS_NODE (set in agent shells) makes the binary behave as plain Node, so it is removed.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "out/Blink-darwin-arm64/Blink.app/Contents/MacOS/Blink");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const baseUrl = (env.BLINK_URL || "http://localhost:3000").replace(/\/+$/, "");

const run = spawnSync(binary, ["--smoke"], { env, encoding: "utf8", timeout: 30_000 });
const fail = (why) => {
  console.error(`desktop smoke FAILED: ${why}`);
  if (run.stdout) console.error(`stdout: ${run.stdout}`);
  if (run.stderr) console.error(`stderr: ${run.stderr}`);
  process.exit(1);
};

if (run.error) fail(`could not run ${binary}: ${run.error.message}`);
if (run.status !== 0) fail(`exit code ${run.status}${run.signal ? ` (signal ${run.signal})` : ""}`);

let parsed = null;
for (const line of run.stdout.split("\n")) {
  try {
    const value = JSON.parse(line);
    if (value && typeof value === "object" && "pill" in value) parsed = value;
  } catch {
    // not the JSON line
  }
}
if (!parsed) fail("no JSON line with a pill in the output");

// The first five pill fields and the control URL are the plan's contract; the rest pin the window rules.
const expected = {
  pill: { alwaysOnTop: true, ignoresMouse: true, width: 600, height: 56, centred: true, visible: false, top: 8 },
  control: { url: `${baseUrl}/desktop` },
  navigation: { offOriginRefused: true, onOriginAllowed: true },
};
const same = Object.keys(expected).every((key) => JSON.stringify(parsed[key]) === JSON.stringify(expected[key]));
if (!same) fail(`unexpected values\n  got:      ${JSON.stringify(parsed)}\n  expected: ${JSON.stringify(expected)}`);

console.log(`desktop smoke ok: ${JSON.stringify(parsed)}`);
