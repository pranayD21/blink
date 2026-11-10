/**
 * Real published firm policies (spec section 11, Task 36).
 *
 * Each policy is an excerpt of a code of ethics filed on EDGAR, kept verbatim
 * in `fixtures/real/policies/<name>.md`. `pnpm eval:policies` compiles each one
 * with Blink's own compiler and writes what came out to
 * `fixtures/real/policies/<name>.compiled.json`. `loadRealPolicy` reads that
 * bundle, so a real call can be evaluated under the policy without a database
 * or a model call. A policy that did not validate is never loaded.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Hex } from "@/core/deps/hash";
import { type Inventory, type Monitor, MonitorsDocSchema, type RulesDoc, RulesDocSchema } from "@/core/policy/schema";
import { type ValidationIssue, compileRules } from "@/core/policy/validate";
import type { CompiledPolicy } from "@/core/runtime/evaluateClaim";

export interface RealPolicy {
  name: string;
  /**
   * Paragraphs marked "must be automated". The rule, chosen before any compile ran: a paragraph is required
   * when it states a duty or prohibition that something said to the firm's people in a conversation can
   * trigger. That is soliciting or receiving inside, material non-public or confidential information;
   * reporting that such information may have been received; or a limit on which experts may be consulted
   * because of who they are. Duties about trading, passing information on, firm administration, call
   * logistics and scripts, and definitions are not marked.
   */
  requiredParagraphs: string[];
}

export const REAL_POLICIES: readonly RealPolicy[] = [
  // P4 report receipt of MNPI; P9 consultations likely to disclose MNPI prohibited; P11 report a disclosure of
  // confidential information; P21 no soliciting it; P22 report inadvertent receipt; P23-P26 restricted experts.
  { name: "oaktree", requiredParagraphs: ["P4", "P9", "P11", "P21", "P22", "P23", "P24", "P25", "P26"] },
  // P8 and P26 notify the CCO of possible MNPI; P11 the same for public-company contacts; P18-P21 experts who
  // may not be approved (bound by an agreement, recent employees, government officials, clinical-trial doctors).
  { name: "sage-rock", requiredParagraphs: ["P8", "P11", "P18", "P19", "P20", "P21", "P26"] },
  // P2 and P8 contact Legal or the Administrator on possible MNPI; P7 do not knowingly accept MNPI; P17 consult
  // Legal on recent-employee consultants; P21 public-company contacts; P23-P24 value-added investors.
  { name: "tcw", requiredParagraphs: ["P2", "P7", "P8", "P17", "P21", "P23", "P24"] },
];

/** What `pnpm eval:policies` wrote for one policy. Ids that differ from run to run are left out. */
export interface RealPolicyBundle {
  name: string;
  title: string;
  sourceTextHash: string;
  requiredParagraphs: string[];
  status: "VALIDATED" | "COMPILE_FAILED";
  bundleHash: string | null;
  attempts: { stage: string; attemptNo: number; issues: string[] }[];
  compileError: { code: string; message: string } | null;
  issues: ValidationIssue[];
  inventory: Inventory | null;
  rulesDoc: RulesDoc | null;
  monitors: Monitor[];
}

const dir = () => resolve(process.cwd(), "fixtures", "real", "policies");
export const realPolicyPath = (name: string) => resolve(dir(), `${name}.md`);
export const realPolicyBundlePath = (name: string) => resolve(dir(), `${name}.compiled.json`);

function known(name: string): RealPolicy {
  const policy = REAL_POLICIES.find((p) => p.name === name);
  if (!policy) throw new Error(`unknown real policy "${name}"; the real policies are ${REAL_POLICIES.map((p) => p.name).join(", ")}`);
  return policy;
}

export function realPolicyText(name: string): string {
  known(name);
  return readFileSync(realPolicyPath(name), "utf8");
}

/** The policy's title: the file's first `# ` heading. */
export function realPolicyTitle(name: string): string {
  return /^#\s+(.+)$/m.exec(realPolicyText(name))?.[1] ?? name;
}

export function readRealPolicyBundle(name: string): RealPolicyBundle {
  known(name);
  const path = realPolicyBundlePath(name);
  if (!existsSync(path)) throw new Error(`real policy "${name}" has no compiled bundle at fixtures/real/policies/${name}.compiled.json; run pnpm eval:policies`);
  return JSON.parse(readFileSync(path, "utf8")) as RealPolicyBundle;
}

/**
 * The compiled rules and monitors for a real policy. Throws, naming the policy, when it did not validate,
 * when its bundle is missing, or when the policy text has changed since the bundle was written.
 */
export function loadRealPolicy(name: string, bundle: RealPolicyBundle = readRealPolicyBundle(name)): CompiledPolicy {
  known(name);
  const textHash = sha256Hex(realPolicyText(name).replace(/\r\n?/g, "\n"));
  if (bundle.sourceTextHash !== textHash) throw new Error(`real policy "${name}" was compiled from different text than fixtures/real/policies/${name}.md; run pnpm eval:policies`);
  if (bundle.status !== "VALIDATED" || !bundle.rulesDoc) {
    const why = bundle.compileError ? `${bundle.compileError.code}: ${bundle.compileError.message}` : [...new Set(bundle.issues.filter((i) => i.severity === "blocking").map((i) => i.code))].join(", ") || "no rules";
    throw new Error(`real policy "${name}" did not validate (${bundle.status}): ${why}`);
  }
  return { rules: compileRules(RulesDocSchema.parse(bundle.rulesDoc)), monitors: MonitorsDocSchema.parse({ monitors: bundle.monitors }).monitors };
}
