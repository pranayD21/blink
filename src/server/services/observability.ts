/**
 * Observability (spec section 8), as data: one call's record, moment by moment, and the overview
 * of all calls. Everything here is read from what the live path recorded: `call_turns` (one wide
 * record per turn), `call_outages`, `call_claims`, `llm_calls`, and the reviewers' decisions.
 *
 * - Nothing fails quietly: every outage and every turn not read live is a moment and a problem.
 * - Every hidden passage traces back to the words, the rule, the policy version and the reviewer.
 * - Every model step names its model, prompt version, tokens and cost; an unknown cost is null.
 * - Speed is typical, 19-in-20 and worst (`summarizeLatency`), never an average.
 *
 * A call's record is for compliance reviewers. The overview is also for the policy owner, and
 * carries no word said on any call.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { GroundedClaim } from "@/core/extraction/ground";
import { describeMoment } from "@/core/live/describe";
import { STAGES, type Stage } from "@/core/live/health";
import { AMBER_MIN_GAP_MS, PILL_TEXT, type PillDecision } from "@/core/live/pill";
import { type LatencySummary, percentile, summarizeLatency } from "@/core/live/stats";
import { predicatePhrase } from "@/core/predicates/registry";
import { type GuardTraceNode, traceLeaves } from "@/core/runtime/monitorReducer";
import type { ClaimRecord, EvidenceState } from "@/core/types";
import { findingCleared } from "@/core/workflow/brief";
import { requireCaseAccess } from "../auth/access";
import { type Actor, requireRole, requireReviewer } from "../auth/actor";
import { nowMs } from "../clock";
import { type DbOrTx, fromJson } from "../db/client";
import { analysisRuns, callClaims, callOutages, callTurns, calls, cases, llmCalls, policyVersions, users } from "../db/schema";
import { notFound } from "../errors";
import { costUsd } from "../llm/client";
import { type CaseFinding, eligibilityForCase } from "./briefs";
import { latestDecision } from "./findingsCore";
import { type CallRow, type TurnEvaluations, spokenTurns } from "./live";
import { turnsOfVersion } from "./loaders";
import { turnPlacer } from "./placement";

// ── The shapes ──────────────────────────────────────────────────────────────

export interface StepView {
  name: "Transcribed" | "Read" | "Rules checked" | "Shown" | "Hidden" | "Reviewed";
  detail: string;
  decidedBy: "model" | "code" | "person" | null;
  meta: string | null;
  /** From the end of the speech, in ms. */
  offsetMs: number | null;
  durationMs: number | null;
}

export interface MomentView {
  kind: "turn" | "outage";
  seq: number | null;
  /** From the start of the call: when the speaker began, or when the outage began. */
  atMs: number;
  speaker: "Banker" | "Expert" | null;
  text: string;
  conclusion: string;
  level: "listening" | "amber" | "red" | "broken";
  /** A turn: from the end of the speech to the pill on screen, null until the app acknowledged it. An outage: how long it lasted. */
  totalMs: number | null;
  steps: StepView[];
}

export interface StageView {
  stage: Stage;
  ok: boolean;
  note: string | null;
}

export interface CallTraceView {
  call: { id: string; caseId: string; title: string; startedAt: string; durationMs: number | null; status: string };
  counts: { turns: number; warnings: number; hidden: number; problems: number; costUsd: number | null; callsWithoutPrice: number };
  stages: StageView[];
  moments: MomentView[];
}

export interface CallsOverview {
  latency: LatencySummary;
  calls: number;
  turns: number;
  turnsWithProblem: number;
  hidden: number;
  unhidden: number;
  typicalCostUsd: number | null;
  stages: StageView[];
  /** For the policy owner, who may not open a call, `callId` is null and `title` is empty. */
  problems: { at: string; callId: string | null; title: string; text: string }[];
  recent: { callId: string; title: string; startedAt: string; turns: number; warnings: number }[];
}

type CallTurnRow = typeof callTurns.$inferSelect;
type CallClaimRow = typeof callClaims.$inferSelect;
type OutageRow = typeof callOutages.$inferSelect;
type LlmCallRow = typeof llmCalls.$inferSelect;

// ── Wording ─────────────────────────────────────────────────────────────────

/**
 * What an outage of each stage cost. A transcribing outage loses speech just as a hearing one does:
 * audio frames that arrive while the speech-to-text socket is down are dropped, never re-sent.
 */
const OUTAGE_WORDING: Record<Stage, { what: string; lost: string }> = {
  hearing: { what: "Blink could not hear the call", lost: "Speech in this gap is not in the transcript." },
  transcribing: { what: "Blink could not hear the call", lost: "Speech in this gap is not in the transcript." },
  reading: { what: "Blink could not read the turns", lost: "Turns in this gap were not checked during the call." },
  rules: { what: "Blink could not check the rules", lost: "Turns in this gap were not checked during the call." },
  screen: { what: "The banker's pill could not be updated", lost: "Warnings in this gap may not have reached the banker." },
};

const REVIEW_STATES: ReadonlySet<string> = new Set(["REVIEW_REQUIRED", "ESCALATION_REQUESTED"]);
const STATE_WORDS: Record<string, string> = { REVIEW_REQUIRED: "review required", ESCALATION_REQUESTED: "escalation requested" };
const EVIDENCE_WORDS: Record<EvidenceState, string> = { supported: "yes", refuted: "no", unknown: "not known", conflict: "conflicting" };

const joinAnd = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => {
  const t = capital(s.trim());
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));
const secondsWords = (ms: number) => plural(seconds(ms), "second");

/** "01:10" from the start of the call; "1:02:03" past an hour. */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const whenLabel = (isoTime: string) => `${WHEN.format(new Date(isoTime))} UTC`;

/** "$0.19", or for the cents a single read costs, two significant figures: "$0.000085". */
export function dollars(usd: number): string {
  if (usd === 0) return "$0";
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${Number(usd.toPrecision(2)).toString()}`;
}

const diff = (later: string | null, earlier: string | null): number | null => {
  if (!later || !earlier) return null;
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
};

// ── Shared reads ────────────────────────────────────────────────────────────

const turnsOf = (db: DbOrTx, callId: string) => db.select().from(callTurns).where(eq(callTurns.callId, callId)).all().sort((a, b) => a.seq - b.seq);
const outagesOf = (db: DbOrTx, callId: string) => db.select().from(callOutages).where(eq(callOutages.callId, callId)).all();
const flaggedOf = (db: DbOrTx, callId: string) => db.select().from(callClaims).where(eq(callClaims.callId, callId)).all().filter((c) => c.flagged !== "none");

/** The call turns ("T5" is seq 5) a flagged claim's quotes rest on. */
const quotedSeqs = (claim: CallClaimRow): number[] =>
  [...new Set(fromJson<ClaimRecord | null>(claim.recordJson, null)?.quotes.map((q) => Number(q.turnLabel.slice(1))) ?? [])].filter(Number.isInteger).sort((a, b) => a - b);

/** When an outage started and ended, in ms; one still open lasts until the call ended, or until now. */
function outageSpan(o: OutageRow, call: CallRow, now: number): { start: number; end: number } {
  const start = Date.parse(o.startedAt);
  const end = Date.parse(o.endedAt ?? call.endedAt ?? new Date(now).toISOString());
  return { start, end: Math.max(start, end) };
}

function stageViews(outages: readonly { stage: Stage; ms: number }[]): StageView[] {
  return STAGES.map((stage) => {
    const down = outages.filter((o) => o.stage === stage);
    if (down.length === 0) return { stage, ok: true, note: null };
    const total = seconds(down.reduce((sum, o) => sum + o.ms, 0));
    return { stage, ok: false, note: down.length === 1 ? `dropped once, ${total} s` : `dropped ${down.length} times, ${total} s in all` };
  });
}

const priceOf = (row: LlmCallRow): number | null =>
  costUsd({ input_tokens: row.inputTokens, output_tokens: row.outputTokens, cache_read_input_tokens: row.cacheReadTokens, cache_creation_input_tokens: row.cacheCreationTokens }, row.model);

/**
 * When a turn's read ran, in ms on the server's clock: it ended when the rules began, `rules_ms`
 * before `decided_at`, and began `read_ms` before that. Null when a time is missing.
 */
function readWindow(t: CallTurnRow): { start: number; end: number } | null {
  const decided = Date.parse(t.decidedAt);
  if (!Number.isFinite(decided) || t.readMs === null) return null;
  const end = decided - (t.rulesMs ?? 0);
  return { start: end - t.readMs, end };
}

/** A model call logged at most this long outside a failed read's window still belongs to it (ISO times are rounded to the ms). */
const WINDOW_SLACK_MS = 50;

interface CallCost {
  /** Null when any model call of the call has no known price, or no record to price. */
  costUsd: number | null;
  callsWithoutPrice: number;
  /** The model call behind each turn's read, by seq, when there is a record of one. */
  readCalls: Map<number, LlmCallRow>;
}

/**
 * The cost of the model calls a call made: its live reads and the after-call read of its transcript.
 *
 * A read the reader gave up on carries no `llm_call_id`, yet the model may have answered and been
 * paid for (a refusal, a truncated or malformed answer): the client logs those with the call's id
 * in `ref_json`. Such a row is priced, and tied to the failed turn whose read window holds it. A
 * failed turn with no row (a timeout logs none) is a model call of unknown cost, never a free one.
 */
function costOfCall(db: DbOrTx, call: CallRow, turns: readonly CallTurnRow[]): CallCost {
  const referenced = new Set(turns.map((t) => t.llmCallId).filter((x): x is string => !!x));
  const named = new Set(referenced);
  if (call.transcriptVersionId) {
    for (const run of db.select().from(analysisRuns).where(eq(analysisRuns.transcriptVersionId, call.transcriptVersionId)).all()) if (run.llmCallId) named.add(run.llmCallId);
  }
  const namedRows = named.size > 0 ? db.select().from(llmCalls).where(inArray(llmCalls.id, [...named])).all() : [];
  const byRef = db.select().from(llmCalls).where(sql`json_extract(${llmCalls.refJson}, '$.callId') = ${call.id}`).all();
  const byId = new Map([...namedRows, ...byRef].map((r) => [r.id, r]));

  let unpriced = [...named].filter((id) => !byId.has(id)).length;
  const readCalls = new Map<number, LlmCallRow>();
  for (const t of turns) {
    const row = t.llmCallId ? byId.get(t.llmCallId) : undefined;
    if (row) readCalls.set(t.seq, row);
  }
  const orphans = byRef.filter((r) => !referenced.has(r.id)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const claimed = new Set<string>();
  for (const t of turns) {
    if (t.readStatus === "read" || t.llmCallId || readCalls.has(t.seq)) continue;
    const window = readWindow(t);
    const match = window
      ? orphans.find((r) => {
          const at = Date.parse(r.createdAt);
          return !claimed.has(r.id) && at >= window.start - WINDOW_SLACK_MS && at <= window.end + WINDOW_SLACK_MS;
        })
      : undefined;
    if (match) {
      claimed.add(match.id);
      readCalls.set(t.seq, match);
    } else unpriced++;
  }

  let total = 0;
  for (const row of byId.values()) {
    const price = priceOf(row);
    if (price === null) unpriced++;
    else total += price;
  }
  return { costUsd: unpriced > 0 ? null : total, callsWithoutPrice: unpriced, readCalls };
}

/**
 * Which findings cover each call turn after the call: a policy finding whose claim quotes the turn,
 * or a live finding with a passage on it, both compared on the current transcript.
 */
function coverageOf(db: DbOrTx, call: CallRow, turns: readonly CallTurnRow[]): (seq: number) => CaseFinding[] {
  if (!call.transcriptVersionId) return () => [];
  // Call turn T<seq> is transcript turn T<n>, n its place among the spoken turns.
  const transcript = new Map(turnsOfVersion(db, call.transcriptVersionId).map((t) => [t.label, t]));
  const placer = turnPlacer(db, call.caseId);
  const eligibility = eligibilityForCase(db, call.caseId, placer);
  const claimLabels = new Map(eligibility.claims.map((c) => [c.claim.row.logicalKey, new Set(c.turnLabels)]));
  const currentLabels = new Map<number, Set<string>>();
  spokenTurns(turns).forEach((t, i) => {
    const turn = transcript.get(`T${i + 1}`);
    currentLabels.set(t.seq, new Set(turn ? (placer.place(turn.id, 0, turn.text.length) ?? []).map((p) => p.turn.label) : []));
  });
  return (seq) => {
    const labels = currentLabels.get(seq);
    if (!labels || labels.size === 0) return [];
    const touches = (set: Iterable<string> | undefined) => [...(set ?? [])].some((l) => labels.has(l));
    return eligibility.findings.filter((f) => (f.origin === "policy" && f.claimLogicalKey !== null && touches(claimLabels.get(f.claimLogicalKey))) || (f.origin === "live" && touches(f.turnLabels)));
  };
}

/** A flagged claim is unhidden when compliance cleared every finding that covers its turns. */
function unhiddenCount(flagged: readonly CallClaimRow[], covering: (seq: number) => CaseFinding[]): number {
  return flagged.filter((c) => {
    const findings = [...new Map(quotedSeqs(c).flatMap(covering).map((f) => [f.id, f])).values()];
    return findings.length > 0 && findings.every(findingCleared);
  }).length;
}

// ── One call ────────────────────────────────────────────────────────────────

interface TraceContext {
  db: DbOrTx;
  call: CallRow;
  turnsBySeq: Map<number, CallTurnRow>;
  startMs: number;
  flagged: CallClaimRow[];
  covering: (seq: number) => CaseFinding[];
  /** The model call behind each turn's read, by seq. */
  readCalls: Map<number, LlmCallRow>;
  policyMeta: string;
  names: Map<string, string>;
}

/** When the speaker began, from the start of the call: the end of speech less its length on the audio clock. */
function turnAtMs(t: CallTurnRow, startMs: number): number {
  const ended = Date.parse(t.speechEndedAt) - startMs;
  return t.speechStartMs === null ? ended : ended - Math.max(0, t.speechEndMs - t.speechStartMs);
}

const leavesOf = (trace: unknown) => (trace && typeof trace === "object" && "op" in trace ? traceLeaves(trace as GuardTraceNode) : []);

/**
 * Where a turn's steps sit, in ms from the end of the speech. `speech_ended_at` (like
 * `response_received_at` and `shown_at`) is the Mac app's clock; `received_at` and `decided_at` are
 * the server's, so an offset that mixes the two carries any skew between the clocks.
 *
 * The rules ended at `decided_at` and the read ended where the rules began. Both are anchored there,
 * not on `received_at`: a turn waits in its call's queue while earlier turns are read, so it is
 * received well before its read begins. That wait is shown on the Read step.
 */
interface TurnTimes {
  readStart: number | null;
  rulesStart: number | null;
  waitMs: number | null;
}

function turnTimes(t: CallTurnRow): TurnTimes {
  const rulesEnd = diff(t.decidedAt, t.speechEndedAt);
  const rulesStart = rulesEnd === null ? null : rulesEnd - (t.rulesMs ?? 0);
  const readStart = rulesStart === null || t.readMs === null ? null : rulesStart - t.readMs;
  const received = diff(t.receivedAt, t.speechEndedAt);
  return { readStart, rulesStart, waitMs: readStart === null || received === null ? null : readStart - received };
}

/** A wait in the queue shorter than this is not worth a word. */
const WAIT_SHOWN_MS = 50;

function readStep(ctx: TraceContext, t: CallTurnRow, claims: GroundedClaim[], evaluations: TurnEvaluations | null, times: TurnTimes): StepView {
  const llm = ctx.readCalls.get(t.seq);
  let meta: string;
  if (llm) {
    const tokensIn = llm.inputTokens + llm.cacheReadTokens + llm.cacheCreationTokens;
    const price = priceOf(llm);
    meta = `${llm.model} · prompt ${llm.promptVersion} · ${tokensIn} tokens in, ${llm.outputTokens} out · ${price === null ? "cost unknown" : dollars(price)}`;
  } else {
    meta = `${ctx.call.readerModel} · prompt ${ctx.call.readerPromptVersion} · tokens and cost unknown`;
  }
  const waited = times.waitMs !== null && times.waitMs > WAIT_SHOWN_MS ? ` Waiting: ${(times.waitMs / 1000).toFixed(1)} s behind earlier turns before the read began.` : "";
  const base = { name: "Read" as const, meta, offsetMs: times.readStart, durationMs: t.readMs };

  // A read that never produced an answer decided nothing, so no model is credited with it.
  if (t.readStatus !== "read") return { ...base, detail: `Not read live (${t.readStatus}).${t.error ? ` ${sentence(t.error)}` : ""}${waited}`, decidedBy: null };
  const parts: string[] = [];
  if (claims.length === 0) parts.push("Nothing a rule looks at.");
  else parts.push(`Found ${plural(claims.length, "claim")}: ${claims.map((c) => c.fields.summary.trim().replace(/\.$/, "")).join("; ")}.`);
  const probe = evaluations?.probe;
  if (probe) parts.push(probe.question.asks_for_fact ? `The question asks for a fact${probe.ruleIds.length > 0 ? ` that rule ${probe.ruleIds.join(", ")} restricts` : ""}.` : "The question asks for no fact.");
  const rejected = fromJson<{ reason: string }[]>(t.rejectedJson, []);
  if (rejected.length > 0) parts.push(`${plural(rejected.length, "claim was", "claims were")} rejected: ${rejected.map((r) => r.reason).join("; ")}.`);
  return { ...base, detail: parts.join(" ") + waited, decidedBy: "model" };
}

function rulesStep(ctx: TraceContext, t: CallTurnRow, evaluations: TurnEvaluations | null, times: TurnTimes): StepView {
  const base = { name: "Rules checked" as const, decidedBy: "code" as const, meta: ctx.policyMeta, offsetMs: times.rulesStart, durationMs: t.rulesMs };
  if (t.readStatus !== "read" || !evaluations) return { ...base, detail: "Nothing to check: the turn was not read live." };

  const lines: string[] = [];
  const monitors = evaluations.claims.flatMap((c) => c.monitors);
  const seen = new Set<string>();
  for (const m of monitors) {
    if (!REVIEW_STATES.has(m.nextState) || m.prevState === m.nextState || seen.has(m.ruleId)) continue;
    seen.add(m.ruleId);
    const leaves = leavesOf(m.guardTrace).map((l) => `${capital(predicatePhrase(l.name, l.params))}: ${EVIDENCE_WORDS[l.state]}.`);
    lines.push(`Rule ${m.ruleId}. ${leaves.join(" ")} Result: ${STATE_WORDS[m.nextState]}.`);
  }
  for (const m of monitors) {
    if (m.nextState !== "NEEDS_CONTEXT" || seen.has(m.ruleId)) continue;
    seen.add(m.ruleId);
    const unknown = leavesOf(m.guardTrace).find((l) => l.state === "unknown");
    lines.push(`Rule ${m.ruleId}: one fact short${unknown ? ` (whether ${predicatePhrase(unknown.name, unknown.params)})` : ""}.`);
  }
  if (evaluations.probe && evaluations.probe.ruleIds.length > 0) lines.push(`The question touches rule ${evaluations.probe.ruleIds.join(", ")}.`);
  if (lines.length === 0) lines.push(evaluations.claims.length > 0 ? `Checked ${plural(evaluations.claims.length, "claim")}. No rule applies.` : "Nothing to check.");
  return { ...base, detail: lines.join(" ") };
}

function shownStep(t: CallTurnRow): StepView {
  const offsetMs = diff(t.responseReceivedAt, t.speechEndedAt);
  const durationMs = diff(t.shownAt, t.responseReceivedAt);
  const meta = t.shownAt ? null : "The banker's app never confirmed it was on screen.";
  const detail =
    t.pill !== "listening" ? `“${PILL_TEXT[t.pill]}”` : t.suppressed ? `Nothing shown: a warning was shown less than ${AMBER_MIN_GAP_MS / 1000} seconds earlier.` : `Nothing new shown. The pill stayed on “${PILL_TEXT.listening}”.`;
  return { name: "Shown", detail, decidedBy: "code", meta, offsetMs, durationMs };
}

const REVIEW_WORDS: Record<string, (what: string) => string> = {
  restricted_exclude: (w) => `kept ${w} hidden.`,
  restricted_escalate_to_legal: (w) => `sent ${w} to legal.`,
  cleared_for_research: (w) => `unhid ${w}.`,
  no_concern: (w) => `unhid ${w}.`,
};

/** The Hidden and Reviewed steps, on a turn a flagged claim quotes. Empty on any other turn. */
function hiddenSteps(ctx: TraceContext, t: CallTurnRow): StepView[] {
  const claims = ctx.flagged.filter((c) => quotedSeqs(c).includes(t.seq));
  if (claims.length === 0) return [];
  const seqs = [...new Set(claims.flatMap(quotedSeqs))].sort((a, b) => a - b);
  const times = seqs.map((s) => {
    const turn = ctx.turnsBySeq.get(s);
    return turn ? clockLabel(turnAtMs(turn, ctx.startMs)) : `T${s}`;
  });
  const ruleIds = [...new Set(claims.flatMap((c) => fromJson<string[]>(c.ruleIdsJson, [])))];
  const hidden: StepView = {
    name: "Hidden",
    detail: ctx.call.status === "live" ? `${joinAnd(times)} blacked out; compliance gets ${seqs.length === 1 ? "it" : "them"} when the call ends.` : `${joinAnd(times)} blacked out and sent to compliance.`,
    decidedBy: "code",
    meta: ruleIds.length > 0 ? `Flagged under rule ${ruleIds.join(", ")}` : null,
    offsetMs: null,
    durationMs: null,
  };

  return [hidden, reviewedStep(ctx, seqs, times)];
}

type Decision = NonNullable<ReturnType<typeof latestDecision>>;
const pronoun = (n: number) => (n === 1 ? "it" : n === 2 ? "both" : `all ${n}`);
const newestFirst = (a: Decision, b: Decision) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

/**
 * What compliance decided about the hidden passages (`seqs`, labelled `times`): the latest decision
 * on each finding that covers any of them. One sentence when every finding stands at the same
 * outcome and together they cover every passage; otherwise one per finding, with its label, and the
 * passages no finding covers.
 */
function reviewedStep(ctx: TraceContext, seqs: readonly number[], times: readonly string[]): StepView {
  const pending = (detail: string): StepView => ({ name: "Reviewed", detail, decidedBy: null, meta: null, offsetMs: null, durationMs: null });
  if (!ctx.call.transcriptVersionId) return pending("Compliance sees it when the call ends.");

  const verdicts = new Map<string, { finding: CaseFinding; seqs: number[]; decision: Decision | null }>();
  for (const seq of seqs) {
    for (const finding of ctx.covering(seq)) {
      const v = verdicts.get(finding.id) ?? { finding, seqs: [], decision: latestDecision(ctx.db, finding.id) };
      v.seqs.push(seq);
      verdicts.set(finding.id, v);
    }
  }
  const all = [...verdicts.values()].sort((a, b) => a.finding.label.localeCompare(b.finding.label, "en", { numeric: true }));
  const decisions = all.map((v) => v.decision).filter((d): d is Decision => d !== null).sort(newestFirst);
  if (decisions.length === 0) return pending("Waiting for compliance.");

  const name = (d: Decision) => ctx.names.get(d.actorId) ?? d.actorId;
  const standing = (d: Decision | null) => (d && !d.stale && d.outcome && REVIEW_WORDS[d.outcome] ? d.outcome : null);
  const phrase = (d: Decision | null, n: number): string => {
    if (!d) return "Waiting for compliance.";
    if (d.stale) return `${name(d)}'s decision no longer stands${d.staleReason ? ` (${d.staleReason})` : ""}. Waiting for a new review.`;
    const words = d.outcome ? REVIEW_WORDS[d.outcome] : undefined;
    return `${name(d)} ${words ? words(pronoun(n)) : `decided (${d.kind.replaceAll("_", " ")}).`}`;
  };

  const covered = new Set(all.flatMap((v) => v.seqs));
  const uncovered = times.filter((_, i) => !covered.has(seqs[i]));
  const outcomes = new Set(all.map((v) => standing(v.decision)));
  let detail: string;
  if (uncovered.length === 0 && all.length === 1) detail = phrase(all[0].decision, seqs.length);
  else if (uncovered.length === 0 && outcomes.size === 1 && !outcomes.has(null)) {
    const who = joinAnd([...new Set(decisions.map(name))]);
    detail = `${who} ${REVIEW_WORDS[decisions[0].outcome!](pronoun(seqs.length))}`;
  } else {
    const lines = all.map((v) => `${v.finding.label}: ${phrase(v.decision, v.seqs.length)}`);
    if (uncovered.length > 0) lines.push(`${joinAnd(uncovered)}: no finding covers ${uncovered.length === 1 ? "it" : "them"} yet. Waiting for compliance.`);
    detail = lines.join(" ");
  }
  const newest = decisions[0];
  return {
    name: "Reviewed",
    detail,
    decidedBy: all.some((v) => standing(v.decision) !== null) ? "person" : null,
    meta: `${whenLabel(newest.createdAt)} · “${newest.rationale}”`,
    offsetMs: null,
    durationMs: null,
  };
}

function turnMoment(ctx: TraceContext, t: CallTurnRow): MomentView {
  const evaluations = fromJson<TurnEvaluations | null>(t.evaluationsJson, null);
  const claims = fromJson<GroundedClaim[]>(t.claimsJson, []);
  const decision: PillDecision = { level: t.pill, reason: t.pillReason as PillDecision["reason"], ruleIds: fromJson<string[]>(t.pillRuleIdsJson, []), suppressed: t.suppressed };
  const monitors = evaluations?.claims.flatMap((c) => c.monitors) ?? [];
  const shortOf = monitors.flatMap((m) => (m.nextState === "NEEDS_CONTEXT" ? leavesOf(m.guardTrace).filter((l) => l.state === "unknown") : []))[0];
  const earlier = [...new Set(claims.flatMap((c) => c.quotes.map((q) => Number(q.turnLabel.slice(1)))))].filter((s) => Number.isInteger(s) && s < t.seq).sort((a, b) => a - b);
  const linkedLabels = earlier.map((s) => {
    const turn = ctx.turnsBySeq.get(s);
    return turn ? clockLabel(turnAtMs(turn, ctx.startMs)) : `T${s}`;
  });

  const transcribed: StepView = { name: "Transcribed", detail: `“${t.text}”`, decidedBy: null, meta: null, offsetMs: 0, durationMs: diff(t.transcribedAt, t.speechEndedAt) };
  const times = turnTimes(t);
  return {
    kind: "turn",
    seq: t.seq,
    atMs: turnAtMs(t, ctx.startMs),
    speaker: t.speaker === "analyst" ? "Banker" : "Expert",
    text: t.text,
    conclusion: describeMoment({
      readStatus: t.readStatus,
      claimCount: evaluations?.claims.length ?? 0,
      decision,
      linkedLabels,
      firstUnknown: shortOf ? `whether ${predicatePhrase(shortOf.name, shortOf.params)}` : null,
    }),
    level: t.pill,
    totalMs: diff(t.shownAt, t.speechEndedAt),
    steps: [transcribed, readStep(ctx, t, claims, evaluations, times), rulesStep(ctx, t, evaluations, times), shownStep(t), ...hiddenSteps(ctx, t)],
  };
}

const STAGE_LABEL: Record<Stage, string> = { hearing: "Hearing", transcribing: "Transcribing", reading: "Reading", rules: "Rules", screen: "Screen" };

function outageMoment(o: OutageRow, call: CallRow, startMs: number, now: number): MomentView {
  const { start, end } = outageSpan(o, call, now);
  const wording = OUTAGE_WORDING[o.stage];
  const lasted = secondsWords(end - start);
  const saw = o.shownToBanker ? `The banker saw “${PILL_TEXT.broken}”` : "The banker was not shown that anything was wrong.";
  return {
    kind: "outage",
    seq: null,
    atMs: start - startMs,
    speaker: null,
    text: `${STAGE_LABEL[o.stage]} was down for ${lasted}.`,
    conclusion: `${wording.what} for ${lasted}. ${sentence(o.cause)} ${saw} ${wording.lost}`,
    level: "broken",
    totalMs: end - start,
    steps: [],
  };
}

const userNames = (db: DbOrTx) => new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));

function policyMetaOf(db: DbOrTx, policyVersionId: string, names: Map<string, string>): string {
  const pv = db.select().from(policyVersions).where(eq(policyVersions.id, policyVersionId)).get();
  if (!pv) return `By code, not a model · policy ${policyVersionId}, which can no longer be found`;
  const by = pv.approvedBy ? `approved by ${names.get(pv.approvedBy) ?? pv.approvedBy}` : "never approved";
  return `By code, not a model · policy ${pv.label}, ${by}`;
}

/** One call's record for compliance: counts, the health of each stage, and every moment in order. */
export function callTrace(db: DbOrTx, callId: string, actor: Actor): CallTraceView {
  requireReviewer(actor);
  const call = db.select().from(calls).where(eq(calls.id, callId)).get();
  if (!call) throw notFound("call");
  const caseRow = requireCaseAccess(db, actor, call.caseId);
  const now = nowMs();
  const startMs = Date.parse(call.startedAt);

  const turns = turnsOf(db, call.id);
  const outages = outagesOf(db, call.id);
  const flagged = flaggedOf(db, call.id);
  const cost = costOfCall(db, call, turns);
  const names = userNames(db);
  const ctx: TraceContext = {
    db,
    call,
    turnsBySeq: new Map(turns.map((t) => [t.seq, t])),
    startMs,
    flagged,
    covering: coverageOf(db, call, turns),
    readCalls: cost.readCalls,
    policyMeta: policyMetaOf(db, call.policyVersionId, names),
    names,
  };

  const moments = [...turns.map((t) => turnMoment(ctx, t)), ...outages.map((o) => outageMoment(o, call, startMs, now))];
  // Stable: two moments at the same instant keep turns in order, then outages.
  moments.sort((a, b) => a.atMs - b.atMs);

  return {
    call: { id: call.id, caseId: call.caseId, title: caseRow.title, startedAt: call.startedAt, durationMs: diff(call.endedAt, call.startedAt), status: call.status },
    counts: {
      turns: turns.length,
      warnings: turns.filter((t) => t.pill !== "listening").length,
      hidden: flagged.length,
      problems: outages.length + turns.filter((t) => t.readStatus !== "read").length,
      costUsd: cost.costUsd,
      callsWithoutPrice: cost.callsWithoutPrice,
    },
    stages: stageViews(outages.map((o) => ({ stage: o.stage, ms: (({ start, end }) => end - start)(outageSpan(o, call, now)) }))),
    moments,
  };
}

// ── All calls ───────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const MAX_PROBLEMS = 10;
const MAX_RECENT = 10;

/**
 * How the live path is doing across every call: the speed from words to the pill (percentiles),
 * stage health over the last hour, calls, turns with a problem, how many hidden passages compliance
 * later unhid, the typical cost of a call, and the newest problems. No word said on any call.
 *
 * It covers every call there has been, with no date window: only stage health looks at the last
 * hour. Task 30 labels the figures accordingly.
 *
 * `recent` lists calls to open, so it is empty for the policy owner, who may not open one; for the
 * same reason a problem names no call or case for them.
 */
export function callsOverview(db: DbOrTx, actor: Actor): CallsOverview {
  requireRole(actor, "reviewer", "senior_reviewer", "policy_owner");
  const now = nowMs();
  const callRows = db.select().from(calls).orderBy(desc(calls.startedAt), desc(calls.id)).all();
  const titles = new Map(db.select({ id: cases.id, title: cases.title }).from(cases).all().map((c) => [c.id, c.title]));

  const latencies: number[] = [];
  const costs: (number | null)[] = [];
  const lastHour: { stage: Stage; ms: number }[] = [];
  const problems: CallsOverview["problems"] = [];
  const recent: CallsOverview["recent"] = [];
  let turnCount = 0;
  let turnsWithProblem = 0;
  let hidden = 0;
  let unhidden = 0;

  const owner = actor.role === "policy_owner";
  for (const call of callRows) {
    const title = titles.get(call.caseId) ?? call.caseId;
    const where = owner ? { callId: null, title: "" } : { callId: call.id, title };
    const turns = turnsOf(db, call.id);
    turnCount += turns.length;
    for (const t of turns) {
      const total = diff(t.shownAt, t.speechEndedAt);
      if (total !== null) latencies.push(total);
      if (t.readStatus !== "read") {
        turnsWithProblem++;
        problems.push({ at: t.speechEndedAt, ...where, text: `Turn ${t.seq} was not read live (${t.readStatus}), so nothing could be shown for it.` });
      }
    }
    for (const o of outagesOf(db, call.id)) {
      const { start, end } = outageSpan(o, call, now);
      if (end >= now - HOUR_MS && start <= now) lastHour.push({ stage: o.stage, ms: end - start });
      problems.push({ at: o.startedAt, ...where, text: `${OUTAGE_WORDING[o.stage].what} for ${secondsWords(end - start)} (${o.cause.trim().replace(/\.$/, "")}).` });
    }
    const flagged = flaggedOf(db, call.id);
    hidden += flagged.length;
    if (flagged.length > 0) unhidden += unhiddenCount(flagged, coverageOf(db, call, turns));
    // An abandoned call (no expert ever spoke) is not a call to price.
    if (call.status !== "abandoned") costs.push(costOfCall(db, call, turns).costUsd);
    if (!owner && recent.length < MAX_RECENT) {
      recent.push({ callId: call.id, title, startedAt: call.startedAt, turns: turns.length, warnings: turns.filter((t) => t.pill !== "listening").length });
    }
  }

  problems.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    latency: summarizeLatency(latencies),
    calls: callRows.length,
    turns: turnCount,
    turnsWithProblem,
    hidden,
    unhidden,
    // One call of unknown cost makes the typical cost unknown too, rather than quietly lower.
    typicalCostUsd: costs.length === 0 || costs.some((c) => c === null) ? null : percentile(costs as number[], 50),
    stages: stageViews(lastHour),
    problems: problems.slice(0, MAX_PROBLEMS),
    recent,
  };
}
