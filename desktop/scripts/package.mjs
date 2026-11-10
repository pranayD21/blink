// Packages the compiled shell as Blink.app for Apple silicon and signs it ad hoc.
// The app is always run packaged: macOS credits the system-audio permission to the responsible
// app, and an unpackaged `electron .` run silently delivers a dead audio track.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [appPath] = await packager({
  dir: root,
  name: "Blink",
  out: path.join(root, "out"),
  platform: "darwin",
  arch: "arm64",
  overwrite: true,
  appBundleId: "dev.blink.app",
  // Ship only the compiled shell: no sources, no build outputs, no dev dependencies.
  ignore: [/^\/(src|scripts|out|node_modules|README\.md|tsconfig\.json)(\/|$)/, /\.tsbuildinfo$/],
  extendInfo: {
    NSAudioCaptureUsageDescription: "Blink listens to the other side of your call to warn you during it.",
    NSMicrophoneUsageDescription: "Blink listens to your side of the call.",
  },
});

const app = path.join(appPath, "Blink.app");
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
console.log(`packaged ${app}`);
