# Blink Live Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blink warns the banker during an expert call with a pill at the top of the screen, hides flagged passages until compliance decides, releases a blanked transcript and a leak-checked summary to the banker, records every step so it can be read back plainly, and runs deployed behind real sign-in.

**Architecture:** A small Electron shell loads two pages served by the existing Next.js app: a control page that captures the microphone and system audio as two channels and streams them to Deepgram Flux, and a transparent pill page. Each finished turn is posted to the server, where a small model fills the existing typed claim form and the existing pure rules in `src/core/` decide the pill. At call end the turns become transcript v1 and the existing after-call pipeline runs; release snapshots a server-side redacted transcript. Every turn is stored as one wide record that the observability screens read.

**Tech Stack:** TypeScript, Next.js 16.4.6 (App Router, `proxy.ts`), React 19, SQLite via better-sqlite3 13 and Drizzle 0.45, Vitest 5, Playwright 1.65, Tailwind 4, `@anthropic-ai/sdk` 1.7.0 (`claude-haiku-5-5` live, `claude-opus-5-5` after the call), Deepgram Flux (`flux-general-en`), Electron (latest stable, 45 or later), Railway.

**Spec:** [docs/superpowers/specs/2026-11-10-live-guidance-design.md](../specs/2026-11-10-live-guidance-design.md), with mockups in [2026-11-10-live-guidance-mockups.html](../specs/2026-11-10-live-guidance-mockups.html). Background: [BLINK_BUILD_SPEC.md](../../../BLINK_BUILD_SPEC.md), [HANDOFF.md](../../../HANDOFF.md). Read the spec before any task. "Section N" below means a section of the spec.

## Global Constraints

- **Pill text, exactly:** `Listening` · `Getting close to inside information. Steer away.` · `Sounds like inside information. Move on.` · `Blink can't hear the call.` · `Call ended. N passages hidden and sent to compliance.` (`1 passage`; for zero, `Call ended. Nothing was hidden.`).
- **Pill behaviour:** no suggested questions, no transcript, no buttons, no sound. One message at a time. A warning stays 6 seconds. Amber at most once in 30 seconds; red is never held back. Broken when any stage has been down more than 3 seconds.
- **Speed target:** warning on screen within 1.0 s of the end of the sentence for a typical turn, within 2.0 s for 19 turns in 20. A turn the reader cannot finish in 2.5 s is recorded as not read live.
- **Who decides:** no model decides a policy outcome, live or after the call. Models fill forms; code in `src/core/` decides.
- **`src/core/` stays pure:** no I/O, clock, randomness or model calls. Time arrives as an argument.
- **Hidden text never leaves the server for a banker:** not in a page, an API response, the summary, an error message or a log the banker can reach. A banker reads nothing from a call until compliance has released it.
- **Observability:** nothing fails quietly; speed is shown as typical (median), 19-in-20 (95th percentile) and worst, never an average; an unknown cost is shown as unknown, never as zero; every model step records model, prompt version, tokens and cost.
- **Look:** quiet and monochrome, one plain line per event, status as a small dot beside words, never a capital-letter badge. Colours come from theme tokens only.
- **Naming:** the interface says "Banker"; the code keeps the role `analyst`.
- **Services:** Deepgram, Anthropic, Railway, SQLite on Railway's disk. Nothing that needs a payment card. No Groq, Cerebras, Supabase or Turso.
- **Secrets:** keys live only in `.env.local` and Railway variables. Never print, log or commit one. When a key must be read from a web page, write it straight to the file and print only its length.
- **Spend cap:** at most $25 of Anthropic usage for this whole plan. Log every paid run in the notes file. Past the cap, stop and ask the owner.
- **Prompts:** any prompt edit bumps its `*_PROMPT_VERSION` and is followed by re-recording. Text from `fixtures/` or from the real test material never appears in a prompt.
- **Next.js:** before writing a route, page, or `proxy.ts` change, read the matching guide under `node_modules/next/dist/docs/01-app/` (`01-getting-started/15-route-handlers.md`, `16-proxy.md`, `02-guides/authentication.md`, `02-guides/self-hosting.md`, `03-api-reference/04-functions/cookies.md`). This is a project rule in `AGENTS.md`.
- **Platform:** the banker's app targets macOS 14.2 or later and is always run packaged, never with `electron .`: macOS grants the system-audio permission to the responsible app, and an unpackaged run silently delivers a dead audio track.
- **Checks before every commit:** `pnpm typecheck && pnpm lint && pnpm test`. Run `pnpm e2e` when the task says so. From Task 17 on, `pnpm live:check` joins `pnpm demo:check` as a standing check.
- **Commits:** one per task, on `main`, staged by path. Conventional Commits subject, a body that says why, and the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. Never push, merge, amend or rebase.
- **Owner steps:** a step whose line contains `(owner)` needs the owner's hands or decision, or can only follow such a step. Do everything around it, write what it waits on in the notes file, and move on. Every other step must be ticked for the plan to be complete.
- **A step that becomes blocked on the owner** may be re-marked by appending ` (owner): <what it waits on>` to its line, but only in the cases this plan names: the browser cannot be reached (Task 1), the spend cap is hit, a prompt still fails after its allowed rounds (Tasks 5, 17, 37), or Railway refuses the deployment for an account reason (Task 43). Nothing else may be re-marked.
- **Steps that turn out not to be needed** (a conditional task) are ticked with the reason written on the same line.
- **Notes file:** `docs/superpowers/plans/2026-11-10-live-guidance-notes.md` holds spike numbers, verdicts, the spend log, what each owner step waits on, and any deviation from this plan with its reason.
- **If time runs short**, the spec's cut order applies (section 12): the all-calls overview first (Task 30, step 5 onward), then Task 34, then the size of the sealed test. Cutting is the owner's call, not the executor's.

## Review Focus

Failure modes the spec implies and that are most likely to hurt a person using this. Each has a test in the task that owns the code.

1. **Two people talk over each other, so two turns end within a few hundred milliseconds.** Both must be read, in order, exactly once, each against the claims the other produced. Test in Task 12.
2. **The network drops mid-call and the app re-sends a turn.** The turn must not be recorded or evaluated twice, and the same pill decision must come back. Test in Task 12.
3. **A call with no expert speech, or one ended seconds after it started.** Ending must not fail; nothing is uploaded; the pill says nothing was hidden. Test in Task 13.
4. **The live reader quotes words that were never said.** The claim is rejected, cannot raise a warning or hide anything, and the turn's record says so. Test in Task 12.
5. **Two restricted statements overlap in one turn, or a hidden passage sits at the very start or end of a turn.** The blanking must merge the spans and reveal no character of either. Test in Task 21.

## How this plan is organised

Ten phases. Each leaves the app working and its checks green, so a phase can be reviewed and stopped at by itself.

| Phase | Tasks | Leaves behind |
|---|---|---|
| 0 Setup | 1 | A Deepgram key that can mint tokens |
| 1 Day-one spike | 2 to 3 | Measured answers to the three risks in section 12 |
| 2 Foundations | 4 to 14 | The live path on the server, driven by tests |
| 3 The banker's side | 15 to 20 | Pill, control page, Mac app, a first real call |
| 4 After the call | 21 to 24 | Blanked transcript and leak-checked summary on release |
| 5 Security | 25 to 28 | Sign-in, access checks, break-in tests |
| 6 Observability | 29 to 30 | The three screens |
| 7 Redesign | 31 to 34 | Every existing screen in the new look |
| 8 Honest testing | 35 to 41 | Results on real material |
| 9 Deploy and demo | 42 to 46 | The deployed app, a live run, the rehearsed demo |

## File map

| Path | Responsibility |
|---|---|
| `src/core/live/*.ts` | Pure live logic: transcript text, pill decision, question probe, stats, health, echo, Flux messages, moment wording, client reducer |
| `src/core/release/redact.ts`, `leak.ts` | Pure blanking of spans and the summary leak check |
| `src/core/extraction/schema.ts` | The claim form shared by both readers, and the live reader's form |
| `src/server/db/schema.ts` | New tables: `calls`, `call_turns`, `call_claims`, `call_outages`, `finding_passages`, `auth_sessions`, `login_attempts`; new columns on `users` and `releases` |
| `src/server/llm/client.ts`, `prompts/live.ts`, `prompts/fields.ts` | Per-call model and timeout; the live prompt; field definitions shared by both prompts |
| `src/server/live/reader.ts` | One model call per finished turn |
| `src/server/services/live.ts` | Start a call, ingest a turn, acknowledge, record an outage, end, reconcile flags |
| `src/server/services/redaction.ts`, `released.ts` | What is restricted on a case; what a banker may read |
| `src/server/services/observability.ts` | One call's record; the all-calls overview |
| `src/server/auth/password.ts`, `sessions.ts`, `mode.ts`, `access.ts` | Hashing, sessions, sign-in mode, case access |
| `src/app/api/calls/**`, `src/app/api/session/**`, `src/app/api/health/route.ts` | Routes |
| `src/app/desktop/**`, `src/lib/live/*`, `src/components/live/*` | Control page, pill page, audio capture, Flux client |
| `src/app/calls/**`, `src/components/calls/*` | Observability screens |
| `src/app/login/page.tsx`, `src/app/analyst/[releaseId]/page.tsx` | Sign-in; the banker's released transcript |
| `desktop/` | The Electron shell: two windows, system-audio grant, packaging |
| `fixtures/real/**`, `scripts/eval-real.ts`, `scripts/speak-call.ts` | Real test material and its harnesses |
| `Dockerfile`, `railway.json`, `scripts/start-prod.sh`, `scripts/smoke-deployed.ts` | Deployment |

---

## Phase 0: Setup

### Task 1: A Deepgram key that can mint short-lived tokens

The key in `.env.local` (`blink-dev`) cannot create tokens: `POST /v1/auth/grant` returned 403 "Insufficient permissions" on 2026-11-10. The banker's app must never hold the real key, so the server needs one with the Member role.

**Files:**
- Create: `scripts/check-deepgram.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `DEEPGRAM_API_KEY` in `.env.local`, accepted by `POST https://api.deepgram.com/v1/auth/grant` (header `Authorization: Token <key>`, body `{"ttl_seconds": 30}`, response `{ access_token, expires_in }`).

- [x] **Step 1: Write `scripts/check-deepgram.ts`.** It calls `loadEnv()`, posts the grant request, prints `grant: <status>` and nothing else, and exits 0 only when the status is 200 and the body has `access_token`.
- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec tsx scripts/check-deepgram.ts`. Expected: `grant: 403`, exit 1.
- [x] **Step 3: Replace the key.** With the playwriter skill, in the browser profile `install:Chrome:15c67h81sse2pk` (already signed in to Deepgram), open the API keys page, create a key named `blink-server` with role **Member** (under "Advanced"), expiry date 2026-12-10. Read the 40-character secret from the page inside the sandbox and write it to `.env.local` as `DEEPGRAM_API_KEY`, replacing the old line; print only its length. Then delete the key `blink-dev`. If the browser cannot be reached, go on and come back to this: every test before Task 38 mocks Deepgram. If it still cannot be reached when Task 38 starts, re-mark this step and the next two as the Global Constraints allow.
- [x] **Step 4: Run it and see it pass.** Expected: `grant: 200`, exit 0.
- [x] **Step 5: Add `DEEPGRAM_API_KEY=` and `BLINK_LIVE_MODEL=claude-haiku-5-5` to `.env.example`, then commit.**

```bash
git add scripts/check-deepgram.ts .env.example
git commit   # chore(deepgram): check that the server key can mint short-lived tokens
```

---

## Phase 1: Day-one spike

Spike code lives in `spike/`, is never committed, and may be thrown away. Only the findings are kept.

### Task 2: Spike: how long from the end of a sentence to a decision

**Files:**
- Create: `docs/superpowers/plans/2026-11-10-live-guidance-notes.md`
- Modify: `.gitignore` (add `/spike/`)

**Interfaces:**
- Produces: a "Spike: speed" section in the notes file with the numbers below and the line `verdict: haiku-ok` or `verdict: haiku-slow`.

- [x] **Step 1: Make three audio clips.** Run `say -o spike/t1.aiff "<a sentence of about fifteen words>"` for three sentences you write yourself (not from `fixtures/`), then `ffmpeg -i spike/t1.aiff -ar 16000 -ac 1 -f s16le spike/t1.pcm`.
- [x] **Step 2: Time Flux.** In `spike/flux-speed.ts`, open `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.8&eot_timeout_ms=7000` with the header `Authorization: Token <key>` (this script runs on this machine, so it may use the key directly), send each clip in 80 ms frames at real-time pace followed by two seconds of silence, and log the delay from the last speech frame to the `EndOfTurn` message. Before writing, confirm the message fields (`event`, `turn_index`, `transcript`, `audio_window_start`, `audio_window_end`) against the Flux reference with the context7 tool. Run ten times per clip.
- [x] **Step 3: Time the reader.** In `spike/reader-speed.ts`, call `claude-haiku-5-5` thirty times through the SDK with `thinking: { type: "disabled" }`, `output_config: { effort: "low", format: <a flat form of about twenty-five enum and string fields> }`, `max_tokens: 2000`, no `fallbacks`, a fixed system prompt of at least 600 tokens with `cache_control: { type: "ephemeral" }`, and a different one-sentence user turn each time. Log request-to-complete time and `usage.cache_read_input_tokens`.
- [x] **Step 4: Write the notes.** Record: Flux end-of-turn delay (median, 95th percentile, worst); reader time (median, 95th percentile, worst); whether cache reads were above zero from the second call on; the sum of the two medians and of the two 95th percentiles against the target of 1.0 s and 2.0 s; dollars spent. Verdict `haiku-ok` when the summed 95th percentile is at most 2.0 s, else `haiku-slow`.
- [ ] **Step 5 (owner): only if the verdict is `haiku-slow`.** The owner decides whether to take Groq out of the backlog (section 6). Until they answer, continue with Haiku 5.5. If the verdict is `haiku-ok`, tick this step with the note "not needed".
- [x] **Step 6: Commit.**

```bash
git add docs/superpowers/plans/2026-11-10-live-guidance-notes.md .gitignore
git commit   # docs(spike): record measured speech-to-decision times
```

### Task 3 (owner): Spike: the Mac app hears a call and floats the pill

**Files:**
- Modify: `docs/superpowers/plans/2026-11-10-live-guidance-notes.md`

**Interfaces:**
- Produces: a "Spike: Mac app" section ending in `verdict: mac-app` or `verdict: fallback`, and the line `audio grant: audio-only` or `audio grant: needs-video`. Tasks 18 and 19 read both.

- [x] **Step 1: Build a throwaway packaged app in `spike/mac/`.** One Electron main file: a transparent, frameless window 600 by 56 at the top centre showing the red pill text, with `setAlwaysOnTop(true, "screen-saver")`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` and `setIgnoreMouseEvents(true)`; a second small window with a Start button that calls `getUserMedia({ audio: true })` and `getDisplayMedia({ video: true, audio: true })`, with `session.defaultSession.setDisplayMediaRequestHandler` answering `{ video: sources[0], audio: "loopback" }`; it prints each audio track's `readyState` and a level meter per channel. Package it with `@electron/packager`, adding `NSAudioCaptureUsageDescription` and `NSMicrophoneUsageDescription` through `extendInfo`, then `codesign --force --deep --sign - <app>`.
- [ ] **Step 2 (owner): grant the two permissions and join the Zoom test meeting.** Open the packaged app, press Start, allow Microphone and System Audio Recording, then open `https://zoom.us/test` in the Zoom app and play its speaker test. About ten minutes.
- [ ] **Step 3, after the (owner) step: record the answers** in the notes file: Is the system-audio track `live`, with a moving level, while Zoom plays? Is the microphone track live? Does the pill stay above Zoom windowed and full screen? Does the handler still deliver audio when it answers with `audio: "loopback"` and no `video` (so that Screen Recording permission is not needed)? With laptop speakers, how much of the far side reaches the microphone channel?
- [ ] **Step 4, after the (owner) step: write the verdict.** `mac-app` when both tracks are live and the pill stays on top; otherwise `fallback`.
- [ ] **Step 5, after the (owner) step: commit the notes.**

```bash
git add docs/superpowers/plans/2026-11-10-live-guidance-notes.md
git commit   # docs(spike): record what the Mac app can hear and show
```

---

## Phase 2: Foundations

### Task 4: Theme tokens and the status dot

New screens are built in the new look from the start; existing screens are restyled in Phase 7.

**Files:**
- Create: `src/components/app/status-dot.tsx`, `src/components/app/theme-provider.tsx`, `tests/core/ui-rules.test.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/app/status-chip.tsx`, `src/components/app/app-header.tsx`, `src/components/app/nav-links.tsx`, `src/components/app/page-shell.tsx`, `src/components/app/role-gate.tsx`, `tests/e2e/demo.spec.ts`

**Interfaces:**
- Produces: `StatusDot({ tone, children, ...span })` with `tone: "good" | "warn" | "stop" | "none" | "ring"`; `StateLabel({ state, ...span })`, which renders a dot and `humanize(state)` and keeps `data-state={state}`; Tailwind colours `bg-warning`, `bg-success`, `bg-destructive`; `UI_RULE_SCOPE: string[]` exported from the test's sibling `tests/helpers/ui-scope.ts` for later tasks to extend.
- `StateChip` keeps its export and now renders `StateLabel`.

- [x] **Step 1: Write the failing test `tests/core/ui-rules.test.ts`.**

```ts
const FORBIDDEN = [/\buppercase\b/, /\b(?:bg|text|border|ring|decoration)-(?:white|black|(?:slate|indigo|sky|violet|amber|red|emerald|gray|zinc)-\d{2,3})\b/];
it.each(filesIn(UI_RULE_SCOPE))("%s uses theme tokens only and no capitals", (file) => {
  const text = readFileSync(file, "utf8");
  for (const rule of FORBIDDEN) expect(text.match(rule)?.[0] ?? null, file).toBeNull();
});
```

`UI_RULE_SCOPE` starts as `["src/components/app", "src/app/layout.tsx"]`.

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/core/ui-rules.test.ts`. Expected: FAIL on `app-header.tsx` (`uppercase`, `bg-sky-50`).
- [x] **Step 3: Replace the palette in `globals.css`.** Light: `--background #ffffff`, `--foreground #0b0b0c`, `--card #ffffff`, `--popover #ffffff`, `--muted #f4f4f5`, `--muted-foreground #6b6b70`, `--secondary #f4f4f5`, `--border #e6e6e9`, `--input #d4d4d8`, `--primary #0b0b0c`, `--primary-foreground #ffffff`, `--ring #a1a1aa`, `--warning #d97706`, `--destructive #dc2626`, `--success #059669`. Dark: the values in the `:root` block of the mockups file, with `--primary #ededee` and `--primary-foreground #0b0b0c`. `--radius: 10px`. Map `--color-warning` and `--color-success` in `@theme inline`. Apply the `-foreground` pairs shadcn expects.
- [x] **Step 4: Follow the system theme.** `theme-provider.tsx` wraps `next-themes` with `attribute="class"` and `defaultTheme="system"`; `layout.tsx` uses it, drops `bg-slate-50 text-slate-900` for `bg-background text-foreground`, and passes the resolved theme to `Toaster`.
- [x] **Step 5: Write `status-dot.tsx` and restyle the files in scope.** The header's two pills become plain muted text with a dot and keep their `data-testid` and their words (`Replay mode`, `Synthetic data`). The `HIGHLIGHT` map becomes token tints: `bg-warning/15`, `bg-destructive/15`, `bg-success/15`, `bg-muted`.
- [x] **Step 6: Move the browser test off capital-letter text.** In `tests/e2e/demo.spec.ts`: every `toHaveText("<STATE>")` on `case-status`, `policy-status` and `brief-status` becomes `toHaveAttribute("data-state", "<STATE>")`; `getByText("REVIEW_REQUIRED")` becomes `locator('[data-state="REVIEW_REQUIRED"]')`; the `fsm-path` pattern becomes `/Unassessed.*Needs context\s*at T5.*Review required\s*at T11/s`.
- [x] **Step 7: Run the checks.** Run: `pnpm exec vitest run tests/core/ui-rules.test.ts && pnpm e2e`. Expected: both PASS.
- [x] **Step 8: Commit.**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/app tests/core/ui-rules.test.ts tests/helpers/ui-scope.ts tests/e2e/demo.spec.ts
git commit   # feat(ui): add theme tokens and a status dot in place of capital-letter badges
```

### Task 5: Clean the prompts, fix the silent miss, re-record

The extraction and policy prompts quote the fixtures they are scored on (HANDOFF, "An honest evaluation"). Clean them before anything new is built on them.

**Files:**
- Create: `src/server/llm/prompts/fields.ts`, `tests/core/prompt-leak.test.ts`
- Modify: `src/server/llm/prompts/extract.ts`, `src/server/llm/prompts/policy.ts`, `src/core/predicates/registry.ts`, `tests/core/predicates.test.ts`, every file in `fixtures/llm-recordings/`

**Interfaces:**
- Produces: `FIELD_GUIDE: string` (the "# Fields" section, used by both readers); `EXTRACT_PROMPT_VERSION = "extract-v2"`; `PASS_A_PROMPT_VERSION = "inventory-v2"`, `PASS_B_PROMPT_VERSION = "rules-v2"`, `ASSEMBLY_PROMPT_VERSION = "assemble-v2"` for each whose text changes; `promptSources(): string[]` and `fixtureSources(): string[]` exported from the leak test's helper `tests/helpers/prompt-leak.ts`.

- [x] **Step 1: Write the failing leak test.**

```ts
// Any run of five consecutive words shared by a prompt and a fixture is a leak.
it.each(promptSources().map((p, i) => [i, p] as const))("prompt %i shares no five-word run with the fixtures", (_i, prompt) => {
  const grams = fiveGrams(prompt);
  for (const src of fixtureSources()) for (const g of fiveGrams(src)) expect(grams.has(g) && !ALLOWED.has(g) ? g : null).toBeNull();
});
```

`fixtureSources()` returns the two Halvorsen transcripts, every `transcript` in `fixtures/cases/variants/*.json`, both policy files, and, once Task 35 exists, every `fixtures/real/**/transcript.txt`. `ALLOWED` starts empty; an entry needs a comment saying why the phrase is unavoidable.

- [x] **Step 2: Write the failing predicate test** in `tests/core/predicates.test.ts`, with the file's own `state` and `claim` helpers:

```ts
it("an uncategorised company figure is unknown, never refuted", () => {
  expect(state("company_specific_operating_metric", claim({ metric: { category: "other", label: "customer churn" }, scope: "company_wide" }))).toBe("unknown");
});
```

- [x] **Step 3: Run both and see them fail.** Run: `pnpm exec vitest run tests/core/prompt-leak.test.ts tests/core/predicates.test.ts`. Expected: the leak test names phrases such as "i still have a login"; the predicate test gets `refuted`.
- [x] **Step 4: Fix the predicate.** In `company_specific_operating_metric`, a metric of category `other` at scope `company_wide`, `segment_or_region` or `single_customer` returns `unknown` with the explanation `"<label>" fits no known category; a reviewer should say whether it is an operating result`.
- [x] **Step 5: Rewrite the examples.** Move the field definitions into `FIELD_GUIDE`. Replace every example taken from a fixture with one from an unrelated business you invent (a software company, an airline), in both prompt files. Keep every instruction; change only examples and any sentence that mirrors the demo policy's wording. Bump the versions.
- [x] **Step 6: Re-record.** Run: `git rm -q fixtures/llm-recordings/*.json && pnpm record && BLINK_LLM_MODE=record pnpm eval`. Expected: `pnpm record` ends with every gold check passing; the eval prints nine fixtures. Log the spend.
- [x] **Step 7: Run the full checks.** Run: `pnpm test && pnpm demo:check`. Expected: PASS. If a fixture's outcome changed, improve the prompt with general guidance only (the leak test still has to pass) and re-record, at most three rounds. If it still differs, stop, write the difference in the notes file, and ask the owner.
- [x] **Step 8: Commit.**

```bash
git add src/server/llm/prompts src/core/predicates/registry.ts tests/core/prompt-leak.test.ts tests/helpers/prompt-leak.ts tests/core/predicates.test.ts fixtures/llm-recordings
git commit   # fix(prompts): remove fixture-derived examples and stop refuting unknown metrics
```

### Task 6: One claim form for both readers

**Files:**
- Modify: `src/core/extraction/schema.ts`, `tests/core/wire.test.ts`

**Interfaces:**
- Produces:

```ts
export const LlmClaimWireSchema: z.ZodObject<...>;            // the element of LlmExtractionWireSchema.claims, unchanged
export type LlmClaimWire = z.infer<typeof LlmClaimWireSchema>;
export function claimFromWire(c: LlmClaimWire): LlmExtraction["claims"][number];
export const LlmQuestionWireSchema = z.object({
  asks_for_fact: z.boolean(),
  subject_kind: z.enum(ENTITY_KINDS), subject_name: z.string(),
  metric_category: z.enum([...METRIC_CATEGORIES, "none"]), event_kind: z.enum(EVENT_KINDS),
  period_relative: z.enum(["current", "prior", "future", "unspecified"]), scope: z.enum(SCOPES),
});
export type LlmQuestionWire = z.infer<typeof LlmQuestionWireSchema>;
export const LlmLiveReadWireSchema = z.object({ claims: z.array(LlmClaimWireSchema), question: LlmQuestionWireSchema });
export type LlmLiveReadWire = z.infer<typeof LlmLiveReadWireSchema>;
```

- [x] **Step 1: Write the failing test** in `tests/core/wire.test.ts`, using the file's existing `claim()` builder:

```ts
it("claimFromWire restores one claim exactly as extractionFromWire does", () => {
  const whole = extractionFromWire({ claims: [claim()], suggested_concerns: [], missing_context_questions: [], call_summary: "" });
  expect(claimFromWire(claim())).toEqual(whole.claims[0]);
});
it("the live form accepts claims plus a question", () => {
  const q = { asks_for_fact: false, subject_kind: "unknown", subject_name: "", metric_category: "none", event_kind: "none", period_relative: "unspecified", scope: "unspecified" };
  expect(LlmLiveReadWireSchema.safeParse({ claims: [claim()], question: q }).success).toBe(true);
});
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/core/wire.test.ts`. Expected: FAIL, `claimFromWire` is not exported.
- [x] **Step 3: Extract the schema and the function** without changing what `extractionFromWire` returns.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS, including `recordings.test.ts` (the request hash does not cover the schema's shape).
- [x] **Step 5: Commit.**

```bash
git add src/core/extraction/schema.ts tests/core/wire.test.ts
git commit   # refactor(extraction): share one claim form between the two readers
```

### Task 7: Live core: transcript text, the pill decision, the question probe

**Files:**
- Create: `src/core/live/transcript.ts`, `src/core/live/pill.ts`, `src/core/live/probe.ts`, `tests/core/live-transcript.test.ts`, `tests/core/live-pill.test.ts`, `tests/core/live-probe.test.ts`

**Interfaces:**
- Consumes: `parseTranscript` (`src/core/transcript/parse.ts`); `evaluateGuard`, `collectPredicates`, `assessClaim`, `fullScope`, `statesOf`, `getPredicate`; `LlmQuestionWire` (Task 6).
- Produces:

```ts
// transcript.ts
export interface LiveTurn { seq: number; speaker: "analyst" | "expert"; text: string; speechStartMs: number | null; speechEndMs: number }
export function liveTranscriptText(turns: readonly LiveTurn[], names: { analyst: string; expert: string }): string;
// pill.ts
export const PILL_TEXT = { listening: "Listening", amber: "Getting close to inside information. Steer away.", red: "Sounds like inside information. Move on.", broken: "Blink can't hear the call." } as const;
export const WARNING_VISIBLE_MS = 6000, AMBER_MIN_GAP_MS = 30000, BROKEN_AFTER_MS = 3000;
export function endedText(hiddenCount: number): string;
export type PillLevel = "listening" | "amber" | "red";
export interface MonitorMove { claimKey: string; ruleId: string; prevState: string; nextState: string; addedQuoteThisTurn: boolean }
export interface PillInput { moves: readonly MonitorMove[]; probeRuleIds: readonly string[]; msSinceLastAmber: number | null }
export interface PillDecision { level: PillLevel; reason: "rule_met" | "question_asks_for_restricted" | "still_one_fact_short" | "none"; ruleIds: string[]; suppressed: boolean }
export function decidePill(input: PillInput): PillDecision;
// probe.ts
export function isTopicPredicate(name: string): boolean;
export function probeClaim(question: LlmQuestionWire, turnLabel: string, ctx: CaseContext): ClaimRecord | null;
export function probeRuleIds(question: LlmQuestionWire, turnLabel: string, env: EvaluationEnv, policy: CompiledPolicy): string[];
```

- [x] **Step 1: Write the failing tests.**

```ts
// live-transcript.test.ts
it("one line per turn, and the parser reads back the same turns", () => {
  const turns = [{ seq: 1, speaker: "analyst", text: "How is demand?", speechStartMs: 1000, speechEndMs: 3000 }, { seq: 2, speaker: "expert", text: "Soft.\nVery soft.", speechStartMs: 70000, speechEndMs: 72000 }] as const;
  const text = liveTranscriptText(turns, { analyst: "Priya Raman", expert: "R. Castellano" });
  expect(text.split("\n")).toEqual(["[00:00:01] Analyst (Priya Raman): How is demand?", "[00:01:10] Expert (R. Castellano): Soft. Very soft."]);
  expect(parseTranscript(text, { filename: "live-call.txt" }).turns.map((t) => [t.label, t.speaker, t.text])).toEqual([["T1", "analyst", "How is demand?"], ["T2", "expert", "Soft. Very soft."]]);
});
// live-pill.test.ts
const move = (prev: string, next: string, added = true): MonitorMove => ({ claimKey: "L1", ruleId: "R1", prevState: prev, nextState: next, addedQuoteThisTurn: added });
it("entering review is red, and red is never held back", () => expect(decidePill({ moves: [move("NEEDS_CONTEXT", "REVIEW_REQUIRED")], probeRuleIds: [], msSinceLastAmber: 100 })).toMatchObject({ level: "red", reason: "rule_met", ruleIds: ["R1"], suppressed: false }));
it("the first step into needs-context shows nothing", () => expect(decidePill({ moves: [move("UNASSESSED", "NEEDS_CONTEXT")], probeRuleIds: [], msSinceLastAmber: null }).level).toBe("listening"));
it("staying one fact short on a turn that adds to the claim is amber", () => expect(decidePill({ moves: [move("NEEDS_CONTEXT", "NEEDS_CONTEXT")], probeRuleIds: [], msSinceLastAmber: null })).toMatchObject({ level: "amber", reason: "still_one_fact_short" }));
it("a question a rule restricts is amber", () => expect(decidePill({ moves: [], probeRuleIds: ["R1", "R4"], msSinceLastAmber: null })).toMatchObject({ level: "amber", reason: "question_asks_for_restricted", ruleIds: ["R1", "R4"] }));
it("a second amber inside thirty seconds is held back and says so", () => expect(decidePill({ moves: [], probeRuleIds: ["R1"], msSinceLastAmber: 29999 })).toMatchObject({ level: "listening", reason: "question_asks_for_restricted", suppressed: true }));
it("ended text", () => expect([0, 1, 3].map(endedText)).toEqual(["Call ended. Nothing was hidden.", "Call ended. 1 passage hidden and sent to compliance.", "Call ended. 3 passages hidden and sent to compliance."]));
// live-probe.test.ts — uses loadManualPolicy() and loadHalvorsenContext() from tests/helpers/fixtures
const q = (over = {}) => ({ asks_for_fact: true, subject_kind: "issuer", subject_name: "", metric_category: "bookings", event_kind: "none", period_relative: "current", scope: "company_wide", ...over });
it("a question about the issuer's current bookings hits R1 and R4", () => expect(probeRuleIds(q(), "T10", env, policy).sort()).toEqual(["R1", "R4"]));
it("an industry question hits nothing", () => expect(probeRuleIds(q({ subject_kind: "industry", scope: "industry_aggregate" }), "T4", env, policy)).toEqual([]));
it("small talk hits nothing", () => expect(probeRuleIds(q({ asks_for_fact: false }), "T2", env, policy)).toEqual([]));
it("a rule with no topic predicate is never hit by a question", () => expect(probeRuleIds(q(), "T10", env, policy)).not.toContain("R2"));
```

- [x] **Step 2: Run them and see them fail.** Run: `pnpm exec vitest run tests/core/live-transcript.test.ts tests/core/live-pill.test.ts tests/core/live-probe.test.ts`. Expected: FAIL, modules not found.
- [x] **Step 3: Implement the three modules.**
  - `liveTranscriptText`: one line per turn, `[HH:MM:SS] Analyst (<name>): <text>`, time from `speechStartMs ?? speechEndMs`, line breaks in text replaced by one space.
  - `decidePill`: red when a move enters `REVIEW_REQUIRED` or `ESCALATION_REQUESTED` from any other state; otherwise amber for a non-empty `probeRuleIds`, or for a move from `NEEDS_CONTEXT` to `NEEDS_CONTEXT` with `addedQuoteThisTurn`; amber is suppressed when `msSinceLastAmber` is below `AMBER_MIN_GAP_MS`.
  - `isTopicPredicate`: the registry entry's `inputs` is non-empty and every input is one of `subject_entity`, `metric`, `event_kind`, `period`, `scope`.
  - `probeClaim`: `null` unless `asks_for_fact`; otherwise a claim with key `probe:<turnLabel>`, the question's subject (name filled with `ctx.issuer` when the kind is `issuer` and the name is blank), metric, event, period and scope, `knowledge_basis: "unstated"`, `access_timing: "unknown"`, no quotes, `solicitedByAnalyst: "yes"`.
  - `probeRuleIds`: a rule is hit when its guard has at least one topic predicate, every topic predicate assesses `supported` on the probe, and `evaluateGuard(...).tri` is not `"false"`.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/core/live/transcript.ts src/core/live/pill.ts src/core/live/probe.ts tests/core/live-transcript.test.ts tests/core/live-pill.test.ts tests/core/live-probe.test.ts
git commit   # feat(live): decide the pill from monitor moves and question probes
```

### Task 8: Live core: stats, health, echo, Flux messages, moment wording, client reducer

**Files:**
- Create: `src/core/live/stats.ts`, `health.ts`, `echo.ts`, `flux.ts`, `describe.ts`, `client.ts` (all under `src/core/live/`), and one test file each under `tests/core/` named `live-<module>.test.ts`

**Interfaces:**
- Produces:

```ts
// stats.ts
export function percentile(values: readonly number[], p: number): number | null;   // nearest rank; null when empty
export interface LatencySummary { n: number; p50: number | null; p95: number | null; max: number | null }
export function summarizeLatency(values: readonly number[]): LatencySummary;
// health.ts
export const STAGES = ["hearing", "transcribing", "reading", "rules", "screen"] as const;
export type Stage = (typeof STAGES)[number];
export function brokenStage(nowMs: number, downSinceMs: Partial<Record<Stage, number>>): Stage | null;
// echo.ts
export function isEchoOf(micText: string, otherText: string): boolean;
// flux.ts
export type FluxEvent =
  | { kind: "update"; turnIndex: number; transcript: string }
  | { kind: "eager_end" | "end"; turnIndex: number; transcript: string; audioStartMs: number; audioEndMs: number }
  | { kind: "start" | "resumed"; turnIndex: number }
  | { kind: "other" };
export function parseFluxMessage(raw: string): FluxEvent;
// describe.ts
export interface MomentFacts { readStatus: "read" | "timeout" | "refused" | "error"; claimCount: number; decision: PillDecision; linkedLabels: string[]; firstUnknown: string | null }
export function describeMoment(m: MomentFacts): string;
// client.ts
export type PillView = { level: "idle" | "listening" | "amber" | "red" | "broken" | "ended"; text: string };
export interface ClientState { shown: PillView; warningUntilMs: number | null; endedUntilMs: number | null; downSinceMs: Partial<Record<Stage, number>> }
export type ClientEvent =
  | { type: "started" } | { type: "decision"; level: PillLevel; atMs: number } | { type: "tick"; nowMs: number }
  | { type: "stage_down"; stage: Stage; atMs: number } | { type: "stage_up"; stage: Stage } | { type: "ended"; hiddenCount: number; atMs: number };
export const INITIAL_CLIENT: ClientState;
export function reduceClient(state: ClientState, event: ClientEvent): ClientState;
```

- [x] **Step 1: Write the failing tests.** The assertions that pin behaviour:

```ts
expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3); expect(percentile([1, 2, 3, 4], 95)).toBe(4); expect(percentile([], 50)).toBeNull();
expect(brokenStage(10_000, { transcribing: 6_999 })).toBe("transcribing"); expect(brokenStage(10_000, { transcribing: 7_000 })).toBeNull();
expect(isEchoOf("orders fell off a cliff they are down", "Honestly, orders fell off a cliff. They're down about twenty percent.")).toBe(true);
expect(isEchoOf("how is demand looking", "Honestly, orders fell off a cliff.")).toBe(false); expect(isEchoOf("yes", "yes")).toBe(false);   // under three words is never an echo
expect(parseFluxMessage('{"type":"TurnInfo","event":"EndOfTurn","turn_index":3,"transcript":"hello there","audio_window_start":1.5,"audio_window_end":2.75}')).toEqual({ kind: "end", turnIndex: 3, transcript: "hello there", audioStartMs: 1500, audioEndMs: 2750 });
expect(parseFluxMessage("not json")).toEqual({ kind: "other" });
// describe.ts: one test per sentence
"Nothing to check. Nothing shown."                                                     // read, no claims, level listening, reason none
"Checked against the policy. No rule applies. Nothing shown."                          // read, claims, reason none
"One fact short of a rule: <firstUnknown>. Watching. Nothing shown."                   // read, claims, firstUnknown set, level listening, not suppressed
"The question asks for something rule R1, R4 restricts. Showed “Getting close to inside information. Steer away.”"
"Still one fact short of rule R1, and the conversation stayed on it. Showed “Getting close to inside information. Steer away.”"
"The question asks for something rule R1 restricts. Not shown: a warning was shown less than 30 seconds earlier."
"Rule R1, R2 is met, linking back to T5. Showed “Sounds like inside information. Move on.”"
"Not read live (timeout). Covered by the after-call read. Nothing shown."
// client.ts
// a warning returns to Listening after exactly 6000 ms; red replaces amber at once; amber does not replace a red still showing;
// broken replaces everything once a stage is down more than 3000 ms and clears on stage_up; ended shows for 10000 ms, then idle.
```

- [x] **Step 2: Run them and see them fail.** Run: `pnpm exec vitest run tests/core/live-stats.test.ts tests/core/live-health.test.ts tests/core/live-echo.test.ts tests/core/live-flux.test.ts tests/core/live-describe.test.ts tests/core/live-client.test.ts`. Expected: FAIL, modules not found.
- [x] **Step 3: Implement.** `isEchoOf`: lower-case, strip punctuation, split on spaces; true when the microphone text has at least three words and at least 80% of them occur in the other text. `brokenStage` returns the first stage in `STAGES` order whose down time exceeds `BROKEN_AFTER_MS`. Confirm the Flux field names against the reference before finalising `parseFluxMessage`.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/core/live tests/core/live-stats.test.ts tests/core/live-health.test.ts tests/core/live-echo.test.ts tests/core/live-flux.test.ts tests/core/live-describe.test.ts tests/core/live-client.test.ts
git commit   # feat(live): add the pure pieces the client and the record share
```

### Task 9: Tables for calls

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: a migration under `drizzle/` (generated), `tests/services/live-schema.test.ts`

**Interfaces:**
- Produces these tables (ids are text; times are ISO text; `*_ms` are integers):

| Table | Columns |
|---|---|
| `calls` | `id`, `case_id`, `started_by`, `policy_version_id`, `status` (`live` \| `ended` \| `abandoned`), `started_at`, `ended_at?`, `last_amber_at?`, `transcript_version_id?`, `analysis_job_id?`, `reader_model`, `reader_prompt_version`, `hidden_count` (default 0), `version` |
| `call_turns` | `id` (`<callId>:<seq>`), `call_id`, `seq`, `speaker` (`analyst` \| `expert`), `text`, `text_hash`, `speech_start_ms?`, `speech_end_ms`, `speech_ended_at`, `transcribed_at`, `received_at`, `read_ms?`, `rules_ms?`, `decided_at`, `response_received_at?`, `shown_at?`, `read_status` (`read` \| `timeout` \| `refused` \| `error`), `llm_call_id?`, `claims_json`, `evaluations_json`, `rejected_json`, `pill` (`listening` \| `amber` \| `red`), `pill_reason`, `pill_rule_ids_json`, `suppressed`, `error?`; unique on (`call_id`, `seq`) |
| `call_claims` | `id` (`<callId>:<key>`), `call_id`, `logical_key`, `record_json`, `monitor_states_json`, `flagged` (`none` \| `needs_context` \| `review_required`), `rule_ids_json`, `first_flagged_seq?`, `updated_at` |
| `call_outages` | `id`, `call_id`, `stage` (the five in `STAGES`), `started_at`, `ended_at?`, `cause`, `shown_to_banker` |
| `finding_passages` | `id`, `finding_id`, `turn_id`, `start_char`, `end_char`; index on `finding_id` |

- `findings.origin` gains `"live"`.

- [x] **Step 1: Write the failing test.**

```ts
it("a call, a turn and a claim can be stored, and a turn's seq is unique per call", () => {
  resetDbForTests();
  // insert one calls row, one call_turns row with seq 1, then a second with seq 1
  expect(() => insertTurn(1)).toThrow(/UNIQUE/);
});
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/live-schema.test.ts`. Expected: FAIL, `calls` is not exported.
- [x] **Step 3: Add the tables, then generate.** Run: `pnpm db:generate`. Expected: one new SQL file under `drizzle/`.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/db/schema.ts drizzle tests/services/live-schema.test.ts
git commit   # feat(db): add tables for live calls and their per-turn record
```

### Task 10: The model client takes a model, a thinking mode and a time limit

**Files:**
- Modify: `src/server/llm/client.ts`, `src/server/services/metrics.ts`, `scripts/record-demo.ts`
- Create: `tests/services/llm-client.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StructuredCallOptions<T> { /* existing */ model?: string; thinking?: "adaptive" | "disabled"; timeoutMs?: number; maxRetries?: number }
export class LlmTimeout extends LlmError {}                    // code "LLM_TIMEOUT"
export function priceFor(model: string): { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
export function costUsd(usage: Pick<LlmUsage, "input_tokens" | "output_tokens"> & Partial<LlmUsage>, model?: string): number | null;
```

- Prices per million tokens: `claude-opus-5-5` 4 / 20 / 0.2 / 5; `claude-haiku-5-5` 0.10 / 0.50 / 0.01 / 0.125. Any other model: `null`.

- [x] **Step 1: Write the failing tests.**

```ts
it("the hash of an existing stage is unchanged", () => {
  const rec = JSON.parse(readFileSync(anyRecording("extract"), "utf8"));
  expect(requestHashFor({ stage: "extract", promptVersion: rec.prompt_version, system: rec.request.system, user: rec.request.user, effort: rec.request.effort, maxTokens: rec.request.max_tokens })).toBe(rec.request_hash);
});
it("a model override and thinking-off change the hash", () => { /* same options plus model: "claude-haiku-5-5", thinking: "disabled" → a different hash */ });
it("prices by model, and an unknown model has no price", () => {
  expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-haiku-5-5")).toBeCloseTo(0.6);
  expect(costUsd({ input_tokens: 1, output_tokens: 1 }, "some-other-model")).toBeNull();
});
it("replay serves a recording made under a model override", async () => { /* BLINK_RECORDINGS_DIR = a temp dir holding one hand-written live_read recording; structuredCall({ ..., model: "claude-haiku-5-5", thinking: "disabled" }) returns it with replayed: true */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/llm-client.test.ts`. Expected: FAIL on the override and price tests.
- [x] **Step 3: Implement.** The hashed object keeps its present keys; `model` becomes `opts.model ?? llmModel()` and a `thinking` key is added only when it is `"disabled"`. With `thinking: "disabled"` send `thinking: { type: "disabled" }`. Send `betas` and `fallbacks` only when no `model` override is given: Haiku 5.5 has no server-side fallback. Pass `{ timeout: opts.timeoutMs, maxRetries: opts.maxRetries }` as the request options when set, and raise `LlmTimeout` when the SDK reports a timeout. The log row stores the model actually requested. Update `metrics.ts` and `record-demo.ts` for the nullable cost: sum known costs and report how many calls had none.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/llm/client.ts src/server/services/metrics.ts scripts/record-demo.ts tests/services/llm-client.test.ts
git commit   # feat(llm): allow a per-call model, thinking off, a time limit, and prices by model
```

### Task 11: The live reader

**Files:**
- Create: `src/server/llm/prompts/live.ts`, `src/server/live/reader.ts`, `tests/services/live-reader.test.ts`, `tests/helpers/live.ts`
- Modify: `src/server/llm/client.ts` (`system` may be a list of blocks), `tests/helpers/prompt-leak.ts`

**Interfaces:**
- Consumes: `structuredCall` with `model`, `thinking`, `timeoutMs`, `maxRetries` (Task 10); `LlmLiveReadWireSchema`, `claimFromWire` (Task 6); `groundExtraction`; `FIELD_GUIDE` (Task 5).
- Produces:

```ts
// prompts/live.ts
export const LIVE_STAGE = "live_read", LIVE_PROMPT_VERSION = "live-v1";
export const LIVE_SYSTEM: string;
export function buildLiveContext(input: { ctx: CaseContext; expert: ExpertProfile; researchQuestions: string[] }): string;   // second system block, fixed for the whole call
export function buildLiveUser(input: { turns: { label: string; speaker: string; text: string }[]; newTurnLabel: string; claimsSoFar: { logicalKey: string; summary: string }[] }): string;
// live/reader.ts
export const LIVE_MODEL = () => process.env.BLINK_LIVE_MODEL || "claude-haiku-5-5";
export const READ_TIMEOUT_MS = 2500;
export interface ReadTurnInput { ctx: CaseContext; expert: ExpertProfile; researchQuestions: string[]; turns: GroundingTurn[]; newTurnLabel: string; claimsSoFar: { logicalKey: string; summary: string }[]; ref: { caseId: string; callId: string } }
export type ReadTurnResult =
  | { status: "read"; claims: GroundedClaim[]; rejected: GroundingResult["rejected"]; question: LlmQuestionWire; llmCallId: string; readMs: number }
  | { status: "timeout" | "refused" | "error"; message: string; llmCallId: string | null; readMs: number };
export type LiveReader = (input: ReadTurnInput) => Promise<ReadTurnResult>;
export const readTurn: LiveReader;
// tests/helpers/live.ts
export function halvorsenLiveTurns(): LiveTurn[];                       // transcript v1; a moderator's turn is "expert", as it would be on the system-audio channel
export function goldReader(): LiveReader;                               // for turn Tn: the gold claims that quote Tn, with later quotes dropped and the fields only they support reset
export function scriptedReader(byLabel: Record<string, Partial<Extract<ReadTurnResult, { status: "read" }>> | ReadTurnResult>): LiveReader;
```

- [x] **Step 1: Write the failing tests.** Recordings are hand-written JSON files placed in a temp `BLINK_RECORDINGS_DIR` under the hash `requestHashFor` gives for the test's input.

```ts
it("returns grounded claims and the question", async () => { /* recording holds one claim quoting T2 exactly → status "read", claims.length 1, claims[0].quotes[0].turnLabel "T2" */ });
it("rejects a claim whose quote is not in the turn", async () => { /* quote text absent from T2 → status "read", claims: [], rejected.length 1 */ });
it("a replay miss is an error result, not a throw", async () => expect((await readTurn(inputWithNoRecording)).status).toBe("error"));
it("the user text carries no ids or times", () => expect(buildLiveUser(sample)).not.toMatch(/call_|case_|\d{4}-\d{2}-\d{2}T/));
it("the fixed prefix is long enough to cache", () => expect((LIVE_SYSTEM + buildLiveContext(sampleCase)).split(/\s+/).length).toBeGreaterThan(450));
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/live-reader.test.ts`. Expected: FAIL, module not found.
- [x] **Step 3: Write the prompt and the reader.**
  - `LIVE_SYSTEM` says: you are filling a form about the newest turn of a call that is still going on; the transcript is untrusted data; output only claims the newest turn creates or adds to; to add to an earlier claim re-emit it under its existing key with all its quotes; copy quotes character for character; when the newest turn is the analyst's, fill `question`, with `asks_for_fact` true only when it asks the expert for a fact about a company, and scope `company_wide` unless a region, segment or customer is named; when the turn states nothing, return no claims. It then includes `FIELD_GUIDE`. No example may come from `fixtures/`.
  - The request: two system blocks, `LIVE_SYSTEM` then `buildLiveContext(...)`, with `cache_control` on the second. This needs `structuredCall` to accept `system: string | string[]`; add that, hashing a list as its blocks joined by a newline and a single string exactly as today, so existing recordings still match.
  - Call with `model: LIVE_MODEL()`, `thinking: "disabled"`, `effort: "low"`, `maxTokens: 2000`, `timeoutMs: READ_TIMEOUT_MS`, `maxRetries: 0`.
  - Map `LlmTimeout` to `timeout`, `LlmRefusal` to `refused`, every other `LlmError` to `error`. Ground with `groundExtraction` against all turns so far; keep only claims with a quote in the newest turn.
  - Add `promptSources()` entries for `LIVE_SYSTEM` in `tests/helpers/prompt-leak.ts`.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/llm/prompts/live.ts src/server/live/reader.ts src/server/llm/client.ts tests/services/live-reader.test.ts tests/helpers/live.ts tests/helpers/prompt-leak.ts
git commit   # feat(live): read each finished turn into the typed claim form
```

### Task 12: Starting a call and ingesting a turn

**Files:**
- Create: `src/server/services/live.ts`, `tests/services/live.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 11; `evaluateClaim`; `compareClaim`, `isComparable`, `toPublicMatchFact`; `loadCaseBundle`, `loadPolicy`, `loadDocumentSet`, `activePolicyVersion`.
- Produces:

```ts
export type CallRow = typeof calls.$inferSelect;
export const StartCallSchema = z.strictObject({ caseId: z.string() });
export function startCall(tx: DbOrTx, input: z.infer<typeof StartCallSchema>, actor: Actor): CallRow;
export const TurnSchema = z.strictObject({ seq: z.number().int().min(1), speaker: z.enum(["analyst", "expert"]), text: z.string().trim().min(1), speechStartMs: z.number().int().min(0).nullable(), speechEndMs: z.number().int().min(0), speechEndedAt: z.string(), transcribedAt: z.string() });
export interface TurnDecision { seq: number; pill: { level: PillLevel; text: string }; decidedAt: string; readStatus: "read" | "timeout" | "refused" | "error" }
export function ingestTurn(callId: string, input: z.infer<typeof TurnSchema>, actor: Actor, deps?: { reader?: LiveReader }): Promise<TurnDecision>;
export function getCallForActor(db: DbOrTx, callId: string, actor: Actor): CallRow;   // 404 unless the actor started it
```

- [x] **Step 1: Write the failing tests.** `beforeEach`: `resetDbForTests()`, `seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true })`. `feed(n)` posts `halvorsenLiveTurns()` 1 to n in order with `goldReader()`.

```ts
it("the first statement shows nothing; the source remark six turns later is red", async () => {
  const d = await feed(11);
  expect(d[4].pill).toEqual({ level: "listening", text: "Listening" });                     // T5
  expect(d[10].pill).toEqual({ level: "red", text: "Sounds like inside information. Move on." });   // T11
  expect(claimRow("C1").flagged).toBe("review_required");
});
it("a question a rule restricts is amber, then held back for thirty seconds", async () => { /* scriptedReader: question on T2 and T3 → amber, then listening with suppressed true */ });
it("a reader timeout is recorded and shows nothing", async () => { /* scriptedReader T2 → { status: "timeout" } → readStatus "timeout", pill listening, call_turns.read_status "timeout" */ });
it("Review Focus 4: a claim with an invented quote raises nothing and is recorded", async () => { /* scriptedReader T2 → { claims: [], rejected: [one] } → pill listening; call_turns.rejected_json has one entry; no call_claims row */ });
it("Review Focus 2: re-sending a turn returns the same decision and stores it once", async () => { /* post seq 5 twice → equal results, one row, the reader called once */ });
it("Review Focus 1: two turns posted together are read in order, each once", async () => {
  const [a, b] = await Promise.all([post(1), post(2)]);
  expect([a.seq, b.seq]).toEqual([1, 2]); expect(readerInputs.map((i) => i.turns.length)).toEqual([1, 2]);
});
it("a gap in seq is refused", async () => expect((await postErr(3)).code).toBe("TURN_OUT_OF_ORDER"));          // 409
it("only the banker who owns the case can start, and only once it has no transcript", () => { /* another analyst → 404; a case past INTAKE → 422 CALL_NOT_ALLOWED; no active policy → 422 NO_ACTIVE_POLICY; starting twice returns the same call */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/live.test.ts`. Expected: FAIL, module not found.
- [x] **Step 3: Implement `startCall` and `ingestTurn`.**
  - `startCall` pins the case's policy version, or the active one when the case has none, and records `LIVE_MODEL()` and `LIVE_PROMPT_VERSION` on the call.
  - One in-memory promise chain per call id serialises `ingestTurn`, so turn n is always read after turn n minus 1 is stored.
  - Inside the chain: return the stored decision when `seq` already exists; refuse when `seq` is not last plus 1; read outside any transaction; then, in one `transact`, store everything.
  - For each claim returned with `fields.speaker === "expert"`: build the `ClaimRecord`; compute the public match in memory with `compareClaim` when `isComparable`; call `evaluateClaim` with `mode: "full"`, `eventType: "CLAIM_EVALUATED"`, `eventIdPrefix: "live:<callId>:<seq>:<key>"` and `currentStates` from `call_claims.monitor_states_json`; turn each monitor into a `MonitorMove` (`addedQuoteThisTurn` is whether the claim quotes the new turn); upsert `call_claims` with `flagged` set to `review_required` if any monitor ends in `REVIEW_REQUIRED` or `ESCALATION_REQUESTED`, else `needs_context` if any ends in `NEEDS_CONTEXT`, else `none`.
  - For an analyst turn, `probeRuleIds(question, ...)`.
  - `decidePill`, with `msSinceLastAmber` from `calls.last_amber_at` and the server clock; update `last_amber_at` when amber is shown.
  - Store the `call_turns` row: everything the table in Task 9 lists, with `evaluations_json` holding, per claim and monitor, the rule id, both states, the result and the guard trace, plus the policy version id.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/live.ts tests/services/live.test.ts
git commit   # feat(live): ingest a turn, apply the policy, and return the pill
```

### Task 13: Ending a call and reconciling what was flagged

**Files:**
- Modify: `src/server/services/live.ts`, `src/server/jobs/handlers/analyzeTranscript.ts`, `src/server/services/findingsCore.ts` (the `origin` type only)
- Create: `tests/services/live-end.test.ts`

**Interfaces:**
- Consumes: `liveTranscriptText` (Task 7); `uploadTranscript`; `createFinding`, `openTask`; `syncCaseStatus`.
- Produces:

```ts
export const AckSchema = z.strictObject({ seq: z.number().int().min(1), responseReceivedAt: z.string(), shownAt: z.string() });
export function ackTurn(tx: DbOrTx, callId: string, input: z.infer<typeof AckSchema>, actor: Actor): void;
export const OutageSchema = z.strictObject({ stage: z.enum(STAGES), startedAt: z.string(), endedAt: z.string().nullable(), cause: z.string().trim().min(1), shownToBanker: z.boolean() });
export function recordOutage(tx: DbOrTx, callId: string, input: z.infer<typeof OutageSchema>, actor: Actor): { outageId: string };
export function endCall(tx: DbOrTx, callId: string, actor: Actor, options?: { source?: "ai" | "gold" }): { hiddenCount: number; pillText: string; jobId: string | null; transcriptVersionId: string | null };   // "gold" is for tests only; no route passes it
export function reconcileLiveFlags(tx: DbOrTx, transcriptVersionId: string): { created: string[] };   // ids of findings it opened
```

- [x] **Step 1: Write the failing tests.**

```ts
it("ending uploads the turns as transcript v1, queues the after-call read, and counts what was flagged", async () => {
  await feed(22); const r = end();
  expect(r.pillText).toBe(endedText(r.hiddenCount)); expect(r.hiddenCount).toBeGreaterThanOrEqual(1); expect(r.jobId).not.toBeNull();
  expect(turnsOfVersion(getDb(), r.transcriptVersionId!).map((t) => t.label).at(-1)).toBe("T22");
});
it("a flag the after-call read also raises opens no second finding", async () => {
  await feed(22); end({ source: "gold" }); await drainJobs();          // the hand-labeled claims stand in for the after-call read, so no network is needed
  expect(findingsOf().filter((f) => f.origin === "live")).toEqual([]);
});
it("a flag the after-call read misses becomes a finding with its passage, and stays for compliance", async () => {
  /* scriptedReader flags T7 as review_required; after-call gold has no finding on T7 */
  const live = findingsOf().filter((f) => f.origin === "live");
  expect(live).toHaveLength(1); expect(live[0]).toMatchObject({ state: "REVIEW_REQUIRED", title: "Flagged during the call" });
  expect(passagesOf(live[0].id).map((p) => p.turnId.split(":").at(-1))).toEqual(["T7"]);
});
it("if the after-call read fails, every live flag still becomes a finding", async () => { /* force the job to fail → one live finding per flagged claim */ });
it("Review Focus 3: a call with no expert speech ends cleanly", async () => {
  await post(1 /* an analyst turn only */);
  expect(end()).toEqual({ hiddenCount: 0, pillText: "Call ended. Nothing was hidden.", jobId: null, transcriptVersionId: null });
  expect(callRow().status).toBe("abandoned");
});
it("an outage becomes a warning on the case", async () => { /* recordOutage 19 s of transcribing, then end → a processing issue with code CALL_GAP whose message names 19 seconds */ });
it("an acknowledgement stores when the pill was shown", () => { /* ackTurn → call_turns.shown_at set */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/live-end.test.ts`. Expected: FAIL, `endCall` is not exported.
- [x] **Step 3: Implement.**
  - `endCall`: refuse unless the call is live. With no expert turn, mark the call `abandoned` and return zeros. Otherwise build the text with `liveTranscriptText(turns, { analyst: actor.name, expert: <expert name from the packet> })`, call `uploadTranscript(tx, caseId, { text, filename: "live-call.txt", sourceLabel: "Live call", source: "ai" }, actor)`, store the version and job ids, set `hidden_count` to the number of `call_claims` rows not flagged `none`, add one `CALL_GAP` warning per outage, and append a `CALL_ENDED` audit event.
  - `reconcileLiveFlags`: find the call by transcript version; for each flagged `call_claims` row, take the turn labels of its quotes; it is covered when a `policy` finding's claim quotes any of those turns. If not covered, `createFinding` with `origin: "live"`, `claimLogicalKey: null`, `title: "Flagged during the call"`, `severity: "high"`, `state: "REVIEW_REQUIRED"`, `reasonCodes: ["LIVE_ONLY", ...ruleIds, ...labels.map((l) => "TURN:" + l)]`, `dedupeKey: "live:<caseId>:<callClaimId>"`, `createdBy: "system"`, and an explanation naming the turns and rules, worded "met rule R1 during the call" for a `review_required` flag and "could not rule out rule R1 by the end of the call" for a `needs_context` one; insert one `finding_passages` row per turn covering its whole text; open a review task; `syncCaseStatus`.
  - Call `reconcileLiveFlags` in `analyzeTranscript` inside the transaction that runs `persistAnalysis`, and in `analyzeTranscriptFailed`.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/live.ts src/server/jobs/handlers/analyzeTranscript.ts src/server/services/findingsCore.ts tests/services/live-end.test.ts
git commit   # feat(live): end a call into the after-call read and keep every live flag for compliance
```

### Task 14: Routes for calls

**Files:**
- Create: `src/app/api/calls/route.ts`, `src/app/api/calls/[id]/turns/route.ts`, `acks/route.ts`, `outages/route.ts`, `end/route.ts`, `stt-token/route.ts` (all under `src/app/api/calls/[id]/`), `tests/services/api-calls.test.ts`
- Modify: `src/server/services/live.ts`

**Interfaces:**
- Produces:

| Route | Who | Body | Reply |
|---|---|---|---|
| `POST /api/calls` | the banker who owns the case | `{ caseId }` | 201 `{ call: { id, status, startedAt } }` |
| `POST /api/calls/:id/turns` | the banker who started it | `TurnSchema` | 200 `TurnDecision` |
| `POST /api/calls/:id/acks` | same | `AckSchema` | 200 `{ ok: true }` |
| `POST /api/calls/:id/outages` | same | `OutageSchema` | 201 `{ outageId }` |
| `POST /api/calls/:id/end` | same | `{}` | 200 the `endCall` result |
| `POST /api/calls/:id/stt-token` | same, while the call is live | `{}` | 200 `{ accessToken, expiresIn }` |

- `export function mintSttToken(callId: string, actor: Actor): Promise<{ accessToken: string; expiresIn: number }>` in `live.ts`.

- [x] **Step 1: Write the failing tests** with the `call()` helper pattern of `tests/services/api.test.ts` (mock `next/headers`; call the handlers directly).

```ts
it("a banker starts a call on their own case and posts a turn", async () => { /* 201, then 200 with pill.level "listening" */ });
it("a reviewer cannot start a call; another banker cannot post to this one", async () => { /* 403; 404 */ });
it("an empty turn is a 400", async () => expect((await call(postTurn, "priya", { body: { ...turn, text: "  " } })).status).toBe(400));
it("the token route returns Deepgram's token and never the key", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "tok", expires_in: 30 })));
  const res = await call(postToken, "priya", { method: "POST", params: { id } });
  expect(res.json).toEqual({ accessToken: "tok", expiresIn: 30 }); expect(JSON.stringify(res.json)).not.toContain(process.env.DEEPGRAM_API_KEY ?? "none");
});
it("a token request after the call ended is a 409", async () => { /* CALL_NOT_LIVE */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/api-calls.test.ts`. Expected: FAIL, routes not found.
- [x] **Step 3: Write the routes** with the `api()` wrapper, one service call each. `mintSttToken` posts to `https://api.deepgram.com/v1/auth/grant` with `{ ttl_seconds: 30 }`; a non-200 from Deepgram becomes a 502 with code `STT_UNAVAILABLE` and no upstream body.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/app/api/calls src/server/services/live.ts tests/services/api-calls.test.ts
git commit   # feat(api): add the routes the banker's app calls during a call
```

---

## Phase 3: The banker's side

### Task 15: The pill page

**Files:**
- Create: `src/components/live/pill.tsx`, `src/app/desktop/pill/page.tsx`, `src/components/app/header-gate.tsx`, `playwright.live.config.ts`, `tests/e2e-live/pill.spec.ts`
- Modify: `package.json`, `src/app/layout.tsx`, `tests/helpers/ui-scope.ts`

**Interfaces:**
- Consumes: `PillView`, `reduceClient`, `PILL_TEXT` (Tasks 7 and 8).
- Produces: `Pill({ view }: { view: PillView })`; the page listens on `new BroadcastChannel("blink-pill")` for `PillView` messages and renders the latest; scripts `e2e:serve:live` and an `e2e` that runs both configs.

- [x] **Step 1: Add the second browser-test setup.** `playwright.live.config.ts` copies `playwright.config.ts` with `testDir: "./tests/e2e-live"`, port 3101 and `command: "pnpm e2e:serve:live"`. In `package.json`:

```json
"e2e": "playwright test && playwright test -c playwright.live.config.ts",
"e2e:serve:live": "BLINK_DB_PATH=./data/e2e-live.db BLINK_LLM_MODE=replay BLINK_AUTH_MODE=switcher BLINK_ALLOW_SWITCHER=1 BLINK_ALLOW_SCRIPTED_CALLS=1 sh -c 'rm -f data/e2e-live.db data/e2e-live.db-wal data/e2e-live.db-shm && mkdir -p data && drizzle-kit migrate && tsx scripts/seed.ts --manual-policy && next build && concurrently -k -n web,worker \"next start -p 3101\" \"tsx scripts/worker.ts\"'"
```

- [x] **Step 2: Write the failing test.**

```ts
const show = (page: Page, view: object) => page.evaluate((v) => new BroadcastChannel("blink-pill").postMessage(v), view);
test("the pill shows exactly what it is sent, and nothing else", async ({ page }) => {
  await page.goto("/desktop/pill");
  for (const [level, text] of [["listening", "Listening"], ["amber", "Getting close to inside information. Steer away."], ["red", "Sounds like inside information. Move on."], ["broken", "Blink can't hear the call."], ["ended", "Call ended. 3 passages hidden and sent to compliance."]]) {
    await show(page, { level, text });
    await expect(page.getByTestId("pill")).toHaveText(text); await expect(page.getByTestId("pill")).toHaveAttribute("data-level", level);
  }
  await show(page, { level: "idle", text: "" }); await expect(page.getByTestId("pill")).toHaveCount(0);
  await expect(page.locator("button, a, input")).toHaveCount(0);
});
```

- [x] **Step 3: Run it and see it fail.** Run: `pnpm exec playwright test -c playwright.live.config.ts tests/e2e-live/pill.spec.ts`. Expected: FAIL, 404 on `/desktop/pill`.
- [x] **Step 4: Build the page.** The pill is one rounded line: a `StatusDot` (`good` for listening and ended, `warn`, `stop`, `ring` for broken) and the text, on `bg-popover` with a hairline border, centred. The page sets `html, body { background: transparent }` so the Mac window shows only the pill. `HeaderGate` is a client component that renders its children unless `usePathname()` starts with `/desktop`; the root layout wraps `AppHeader` in it. Add `src/components/live` and `src/app/desktop` to `UI_RULE_SCOPE`.
- [x] **Step 5: Run the tests.** Run: `pnpm e2e`. Expected: PASS for both configs.
- [x] **Step 6: Commit.**

```bash
git add src/components/live src/app/desktop src/components/app/header-gate.tsx src/app/layout.tsx playwright.live.config.ts tests/e2e-live/pill.spec.ts package.json tests/helpers/ui-scope.ts
git commit   # feat(pill): show one quiet line with five possible messages
```

### Task 16: Audio capture, the Flux client, and the call session

**Files:**
- Create: `public/pcm-worklet.js`, `src/lib/live/audio.ts`, `src/lib/live/flux-client.ts`, `src/lib/live/session.ts`, `src/core/live/turns.ts`, `tests/core/live-turns.test.ts`

**Interfaces:**
- Consumes: `parseFluxMessage`, `isEchoOf`, `reduceClient`, `brokenStage` (Task 8); the routes of Task 14.
- Produces:

```ts
// core/live/turns.ts (pure): turns two Flux event streams into ordered turns
export interface ChannelEvent { channel: "analyst" | "expert"; event: FluxEvent; atMs: number }       // atMs: wall clock when the message arrived
export interface FinishedTurn { speaker: "analyst" | "expert"; text: string; speechStartMs: number; speechEndMs: number; transcribedAtMs: number }
export interface TurnAssembler { push(e: ChannelEvent): FinishedTurn[] }
export function createTurnAssembler(): TurnAssembler;
// lib/live
export interface AudioChannels { analyst: MediaStream; expert: MediaStream; stop(): void }
export function captureChannels(): Promise<AudioChannels>;                       // microphone, and system audio through getDisplayMedia
export function openFlux(token: string, stream: MediaStream, onMessage: (raw: string, atMs: number) => void, onState: (up: boolean) => void): { close(): void };
export interface TurnSource { start(onTurn: (t: FinishedTurn) => void, onStage: (stage: Stage, up: boolean) => void): Promise<void>; stop(): void }
export function liveTurnSource(callId: string): TurnSource;
export function runCall(opts: { caseId: string; source: TurnSource; onView: (v: PillView) => void }): Promise<{ end(): Promise<void> }>;
```

- [x] **Step 1: Write the failing test** for the assembler.

```ts
it("emits a turn on EndOfTurn with the channel's speaker and clocks", () => { /* end event on "expert" at 2750 ms audio → one FinishedTurn { speaker: "expert", speechEndMs: 2750 } */ });
it("ignores eager ends, updates and empty transcripts", () => { /* → [] */ });
it("drops a microphone turn that echoes the far side within four seconds", () => { /* expert end, then analyst end 1.2 s later whose words are in the expert's → only the expert turn */ });
it("keeps a microphone turn that says something else", () => { /* → both, in arrival order */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/core/live-turns.test.ts`. Expected: FAIL, module not found.
- [x] **Step 3: Implement the assembler, then the browser modules.**
  - Audio: an `AudioContext` at 16,000 Hz per channel; the worklet posts 1,280-sample frames (80 ms) as 16-bit PCM.
  - Flux: `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.8&eot_timeout_ms=7000`, one socket per channel, authenticated with the short-lived token the way Deepgram documents for browsers (confirm with context7 before writing). On close, mint a new token and reconnect with backoff of 250 ms doubling to 4 s; report `transcribing` down and up.
  - Session: `POST /api/calls`, then for each finished turn `POST .../turns` with the next `seq`, `speechEndedAt` computed as the channel's audio start wall time plus `speechEndMs`; on the reply dispatch `decision` to `reduceClient` and post the acknowledgement with the two client times; a turn request that fails or takes over 3 s marks `reading` down and is retried with the same `seq` until it succeeds; a 401 stops the call and shows broken. A 250 ms timer dispatches `tick`. Every stage that goes down and comes back posts one outage. `end()` posts `.../end` and dispatches `ended`.
  - A track whose `readyState` is `ended`, or a level of exactly zero for three seconds on the system-audio channel while the microphone hears speech, marks `hearing` down.
- [x] **Step 4: Run the tests.** Run: `pnpm test && pnpm typecheck`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/lib/live public/pcm-worklet.js src/core/live/turns.ts tests/core/live-turns.test.ts
git commit   # feat(live): capture two channels, follow Flux, and run a call session
```

### Task 17: The control page, a scripted call, and its recordings

A deployed Blink always reads live. The scripted call exists so that tests and the browser test can drive a whole call with no network: its turns are fixed, so the reader's requests are identical each time and replay from recordings like every other stage.

**Files:**
- Create: `src/app/desktop/page.tsx`, `src/components/live/call-control.tsx`, `src/lib/live/script-source.ts`, `src/app/api/dev/script-turns/route.ts`, `scripts/record-live.ts`, `tests/e2e-live/call.spec.ts`
- Modify: `package.json`, `tests/services/recordings.test.ts`, `fixtures/llm-recordings/` (new files)

**Interfaces:**
- Consumes: `runCall`, `TurnSource` (Task 16); `halvorsenLiveTurns` logic, moved from `tests/helpers/live.ts` into `src/server/services/seed.ts` as `halvorsenLiveTurns()` and re-exported by the helper.
- Produces: `/desktop` for the `analyst` role: the banker's cases still at intake, a Start button per case, Stop while live, and one line of stage dots; `scriptTurnSource(turns, paceMs)`; `GET /api/dev/script-turns` (404 unless `BLINK_ALLOW_SCRIPTED_CALLS=1`); scripts `record:live` and `live:check`.

- [x] **Step 1: Write `scripts/record-live.ts`.** In a scratch database: seed with the manual policy, start a call as Priya on the Halvorsen case, feed `halvorsenLiveTurns()` through `ingestTurn` with the real reader, end the call, drain the jobs, print each turn's label, pill and read status, and exit 1 unless the pill is red at T11 and no turn has a read status other than `read`. Add:

```json
"record:live": "BLINK_LLM_MODE=record tsx scripts/record-live.ts",
"live:check": "BLINK_LLM_MODE=replay tsx scripts/record-live.ts"
```

- [x] **Step 2: Record.** Run: `pnpm record:live`. Expected: about 22 `live_read-*.json` files and one new `extract-*.json`; exit 0. If T11 is not red, improve `LIVE_SYSTEM` with general guidance only, bump the version, delete the `live_read` recordings and record again, at most three rounds; then stop and ask the owner. Log the spend.
- [x] **Step 3: Write the failing browser test.**

```ts
test("a scripted call turns the pill red at the source remark and ends with a count", async ({ page, context }) => {
  await actAs(page, "user_priya", "Priya Raman");
  const pill = await context.newPage(); await pill.goto("/desktop/pill");
  await page.goto("/desktop?source=script&pace=150");
  await page.getByTestId("start-call-case_halvorsen").click();
  await expect(pill.getByTestId("pill")).toHaveAttribute("data-level", "red", { timeout: 30_000 });
  await expect(page.getByTestId("call-ended")).toBeVisible({ timeout: 60_000 });
  await expect(pill.getByTestId("pill")).toHaveText(/^Call ended\. \d+ passages? hidden and sent to compliance\.$/);
  await expect(page.locator("text=/orders fell|dashboard/i")).toHaveCount(0);       // the banker sees no transcript
});
```

- [x] **Step 4: Run it and see it fail.** Expected: FAIL, 404 on `/desktop`.
- [x] **Step 5: Build the page and the scripted source.** The control page shows no transcript text at any point. With `?source=script` and the server flag set, it uses `scriptTurnSource` fed from the dev route; otherwise `liveTurnSource`. It posts every `PillView` to the `blink-pill` channel, and calls `window.blinkDesktop?.setPillVisible(...)` when that object exists.
- [x] **Step 6: Extend `tests/services/recordings.test.ts`** with one case that runs the same script in replay and expects red at T11.
- [x] **Step 7: Run the checks.** Run: `pnpm test && pnpm live:check && pnpm e2e`. Expected: PASS.
- [x] **Step 8: Commit.**

```bash
git add src/app/desktop src/components/live src/lib/live/script-source.ts src/app/api/dev scripts/record-live.ts tests/e2e-live/call.spec.ts tests/services/recordings.test.ts tests/helpers/live.ts src/server/services/seed.ts package.json fixtures/llm-recordings
git commit   # feat(desktop): start and stop a call from a control page, with a scripted call for tests
```

### Task 18: The Mac app

Build this unless the notes file says `verdict: fallback`; in that case tick this task's steps with the note "not built: spike verdict fallback" and go to Task 19. If Task 3 has not been done yet, build it anyway and assume `audio grant: needs-video`.

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/scripts/package.mjs`, `desktop/README.md`
- Modify: `package.json`, `tsconfig.json` (exclude `desktop`), `eslint.config.mjs` (ignore `desktop/out`, `desktop/dist`), `.gitignore`

**Interfaces:**
- Consumes: `/desktop` and `/desktop/pill` (Tasks 15 and 17); the spike's `audio grant` line.
- Produces: `desktop/out/Blink-darwin-arm64/Blink.app`; `window.blinkDesktop = { isDesktop: true, setPillVisible(visible: boolean): void }`; root scripts `desktop:build` and `desktop:smoke`.

- [x] **Step 1: Write the smoke check first.** `main.ts` accepts `--smoke`: it creates both windows, prints one JSON line `{ "pill": { "alwaysOnTop": true, "ignoresMouse": true, "width": 600, "height": 56, "centred": true }, "control": { "url": "<BLINK_URL>/desktop" } }`, and quits with code 0. `desktop:smoke` runs the packaged app with `--smoke` and fails unless that line parses with those values.
- [x] **Step 2: Run it and see it fail.** Run: `pnpm desktop:build && pnpm desktop:smoke`. Expected: FAIL, nothing is built yet.
- [x] **Step 3: Write the shell.**
  - `BLINK_URL` from `--server=` or the environment, default `http://localhost:3000`.
  - Control window 420 by 560 loading `<BLINK_URL>/desktop`. Pill window 600 by 56: `frame: false`, `transparent: true`, `resizable: false`, `movable: false`, `focusable: false`, `hasShadow: false`, `skipTaskbar: true`; `setAlwaysOnTop(true, "screen-saver")`; `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`; `setIgnoreMouseEvents(true)`; x centred on the primary display's work area, y 8 below its top; hidden until `setPillVisible(true)`.
  - `setDisplayMediaRequestHandler` answers with `audio: "loopback"`, and with a screen source as `video` only if the spike recorded `audio grant: needs-video`.
  - `setPermissionRequestHandler` allows `media` for `BLINK_URL`'s origin only. Navigation and new windows outside that origin are refused. `contextIsolation: true`, `nodeIntegration: false`.
  - `scripts/package.mjs` uses `@electron/packager` with `extendInfo` for `NSAudioCaptureUsageDescription` ("Blink listens to the other side of your call to warn you during it.") and `NSMicrophoneUsageDescription` ("Blink listens to your side of the call."), then ad-hoc signs the app.
  - Pin Electron exactly in `desktop/package.json` and allow its install script there.
- [x] **Step 4: Run the smoke check.** Run: `pnpm desktop:build && pnpm desktop:smoke`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add desktop package.json tsconfig.json eslint.config.mjs .gitignore
git commit   # feat(desktop): add the Mac shell that floats the pill and grants system audio
```

### Task 19: The Chrome fallback (conditional)

Build this only if the notes file says `verdict: fallback`. If it says `mac-app`, or has no verdict yet, tick every step with the note "not needed: spike verdict mac-app" or "not built: no spike verdict yet".

**Files:**
- Modify: `src/components/live/call-control.tsx`, `src/lib/live/audio.ts`
- Create: `src/lib/live/pip.ts`

**Interfaces:**
- Produces: `openPillWindow(): Promise<{ render(view: PillView): void; close(): void }>` using `documentPictureInPicture.requestWindow({ width: 480, height: 56 })`.

- [x] **Step 1: Write the failing browser test** in `tests/e2e-live/call.spec.ts`: with `?source=script` in plain Chromium, Start opens a picture-in-picture window whose `[data-testid=pill]` reaches `data-level="red"`. — not built: no spike verdict yet
- [x] **Step 2: Run it and see it fail.** — not built: no spike verdict yet
- [x] **Step 3: Implement.** When `window.blinkDesktop` is absent, the Start click opens the pill window before anything else (it needs the click), and audio capture asks for a tab with audio. The control page tells the banker to run the call in a Chrome tab and to drag the pill to the top once. — not built: no spike verdict yet
- [x] **Step 4: Run the tests.** Run: `pnpm e2e`. Expected: PASS. — not built: no spike verdict yet
- [x] **Step 5: Commit.** — not built: no spike verdict yet

```bash
git add src/components/live/call-control.tsx src/lib/live/audio.ts src/lib/live/pip.ts tests/e2e-live/call.spec.ts
git commit   # feat(desktop): fall back to a floating Chrome window for the pill
```

### Task 20 (owner): A first real call

**Files:**
- Modify: `docs/superpowers/plans/2026-11-10-live-guidance-notes.md`

- [x] **Step 1: Prepare.** Start from an empty database with the Halvorsen case at intake and the manual policy active: `rm -f data/blink.db data/blink.db-wal data/blink.db-shm && pnpm exec drizzle-kit migrate && pnpm exec tsx scripts/seed.ts --manual-policy`. Start `BLINK_LLM_MODE=live pnpm dev` and open the packaged app.
- [ ] **Step 2 (owner): hold a five-minute call.** With headphones, in Zoom, with a second person or a second device reading the expert's side of a script the owner writes. Say at least one thing the demo policy restricts. Stop the call.
- [ ] **Step 3, after the (owner) step: read the record back.** From `call_turns`: the number of turns, how many were not read live, the median, 95th percentile and worst of `shown_at` minus `speech_ended_at`, and whether the pill went red where expected. Write these in the notes file against the targets. If the 95th percentile is over 2.0 s, write which stage took the time.
- [ ] **Step 4, after the (owner) step: commit the notes.**

```bash
git add docs/superpowers/plans/2026-11-10-live-guidance-notes.md
git commit   # docs: record the first real call's timings
```

---

## Phase 4: After the call

### Task 21: Blanking spans and checking a summary for leaks (pure)

**Files:**
- Create: `src/core/release/redact.ts`, `src/core/release/leak.ts`, `tests/core/release-redact.test.ts`, `tests/core/release-leak.test.ts`

**Interfaces:**
- Produces:

```ts
// redact.ts
export interface Span { turnLabel: string; start: number; end: number }                    // offsets inside the turn's text
export type Segment = { text: string } | { hidden: number };                               // hidden: how many characters were blanked
export interface RedactedTurn { label: string; speaker: string; speakerName: string; timestamp: string | null; segments: Segment[] }
export function mergeSpans(spans: readonly Span[]): Span[];
export function redactTurns(turns: readonly { label: string; speaker: string; speakerName: string; timestamp: string | null; text: string }[], spans: readonly Span[]): { turns: RedactedTurn[]; hiddenPassages: number };
// leak.ts
export interface HiddenPassage { label: string; text: string; numbers: number[]; names: string[] }
export interface Leak { passage: string; kind: "quote" | "figure" | "name"; detail: string }
export function spellNumber(n: number): string | null;                                     // whole numbers 0 to 100
export function findLeaks(sentences: readonly string[], hidden: readonly HiddenPassage[], visible: { numbers: ReadonlySet<number>; names: ReadonlySet<string> }): Leak[];
```

- [x] **Step 1: Write the failing tests.**

```ts
// redact
const turn = { label: "T5", speaker: "expert", speakerName: "R", timestamp: null, text: "Honestly, orders fell. Down twenty percent." };
it("blanks a span and keeps the rest", () => expect(redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }]).turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 12 }, { text: " Down twenty percent." }]));
it("Review Focus 5: overlapping and touching spans merge, and nothing between them shows", () => {
  const r = redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }, { turnLabel: "T5", start: 18, end: 30 }, { turnLabel: "T5", start: 30, end: 43 }]);
  expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 33 }]); expect(r.hiddenPassages).toBe(1);
});
it("Review Focus 5: a span at the very start or end leaves no empty text segment", () => expect(redactTurns([turn], [{ turnLabel: "T5", start: 0, end: 9 }]).turns[0].segments[0]).toEqual({ hidden: 9 }));
it("a span past the end of the text is clamped, and an unknown turn label is ignored", () => { /* end: 999 → hidden to the end; turnLabel "T99" → turn unchanged */ });
it("the output never contains a blanked character", () => expect(JSON.stringify(redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }]))).not.toContain("orders fell"));
// leak
const hidden = [{ label: "F1 · T5", text: "They're down about twenty percent in the West region.", numbers: [20], names: ["West region"] }];
const none = { numbers: new Set<number>(), names: new Set<string>() };
it("five words in a row from a hidden passage is a quote leak", () => expect(findLeaks(["Sources say they're down about twenty percent overall."], hidden, none)[0]).toMatchObject({ kind: "quote" }));
it("a hidden figure, as digits or as a word, is a leak", () => { expect(findLeaks(["Bookings fell 20%."], hidden, none)[0].kind).toBe("figure"); expect(findLeaks(["Bookings fell twenty percent."], hidden, none)[0].kind).toBe("figure"); });
it("the same figure is not a leak when a visible statement also carries it", () => expect(findLeaks(["Prices rose 20%."], hidden, { numbers: new Set([20]), names: new Set() })).toEqual([]));
it("a name that appears only in hidden passages is a leak", () => expect(findLeaks(["The West region was weak."], hidden, none)[0].kind).toBe("name"));
it("a clean summary has no leaks", () => expect(findLeaks(["Distributors are working through inventory."], hidden, none)).toEqual([]));
```

- [x] **Step 2: Run them and see them fail.** Run: `pnpm exec vitest run tests/core/release-redact.test.ts tests/core/release-leak.test.ts`. Expected: FAIL, modules not found.
- [x] **Step 3: Implement.** Words are compared lower-cased with punctuation removed. A figure matches as a whole number token, with or without `%` or "percent". A name matches as whole words, case-insensitively.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/core/release tests/core/release-redact.test.ts tests/core/release-leak.test.ts
git commit   # feat(release): blank restricted spans and detect a summary that leaks them
```

### Task 22: Release snapshots the blanked transcript and refuses a leaking summary

**Files:**
- Create: `src/server/services/redaction.ts`
- Modify: `src/server/db/schema.ts` (and a generated migration), `src/core/workflow/brief.ts`, `src/server/services/release.ts`, `src/server/services/briefs.ts`, `tests/services/release.test.ts`, `tests/core/workflow.test.ts`

**Interfaces:**
- Consumes: Task 21; `eligibilityForCase`; `latestDecision`; `finding_passages` (Task 9).
- Produces:

```ts
// redaction.ts
export function restrictedOnCase(tx: DbOrTx, caseId: string): { spans: Span[]; passages: HiddenPassage[]; visible: { numbers: Set<number>; names: Set<string> } };
// brief.ts
ReleaseCheckInput gains: leaks: { passage: string; kind: string; detail: string }[]
ReleaseFailure["code"] gains: "SUMMARY_LEAK"
// schema: releases gains transcript_version_id (text), redacted_transcript_json (text), redacted_transcript_hash (text), hidden_passages (integer)
```

- A passage is restricted when it is a quote of a claim whose eligibility reason is `restricted`, or a `finding_passages` row of a `live` finding whose latest decision is `restricted_exclude` or `restricted_escalate_to_legal`.
- A claim that quotes any turn of a `live` finding not decided `cleared_for_research` or `no_concern` is not eligible, with reason `restricted`.

- [x] **Step 1: Write the failing tests** in `tests/services/release.test.ts`, on `seedAnalyzed()` and the existing helpers.

```ts
it("release stores a transcript with the restricted quotes blanked", () => {
  const brief = reviewAndApprove(); const r = release(brief.id); expect(r.released).toBe(true);
  const row = releaseRow(); const text = row.redactedTranscriptJson;
  expect(text).not.toContain("I still have a login"); expect(text).not.toContain("Cardinal");        // F1 and F2 were restricted
  expect(text).toContain("well before I left");                                                        // F3 was cleared
  expect(row.hiddenPassages).toBeGreaterThanOrEqual(2);
});
it("a summary that repeats a restricted figure cannot be released", () => {
  /* edit the brief to add a sentence with the restricted figure citing an eligible claim, approve, release */
  expect(result).toMatchObject({ released: false }); expect(codes(result)).toContain("SUMMARY_LEAK");
});
it("the snapshot does not change when a corrected transcript arrives later", async () => { /* release, uploadV2(), → the stored redacted_transcript_hash is unchanged and the brief's standing is under_re_review */ });
it("a claim on a turn that is flagged live-only is not eligible", () => { /* live finding on T7 undecided → eligibility of the claim quoting T7 is { eligible: false, reason: "restricted" } */ });
```

Add to `tests/core/workflow.test.ts`: `checkRelease` with one leak returns a failure with code `SUMMARY_LEAK` whose message names the passage label and kind and does not contain the passage text.

- [x] **Step 2: Run them and see them fail.** Run: `pnpm exec vitest run tests/services/release.test.ts tests/core/workflow.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.** In `releaseBrief`, after the staleness pass: compute `restrictedOnCase`, run `findLeaks` over the brief's sentences, pass `leaks` to `checkRelease`. On success, `redactTurns` over the current transcript's turns, and store the result, its hash and the count on the release row. A leak's message is `the summary repeats a <kind> from hidden passage <label>`; it never includes the text.
- [x] **Step 4: Run the tests.** Run: `pnpm db:generate && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/redaction.ts src/server/db/schema.ts drizzle src/core/workflow/brief.ts src/server/services/release.ts src/server/services/briefs.ts tests/services/release.test.ts tests/core/workflow.test.ts
git commit   # feat(release): store the blanked transcript at release and block a leaking summary
```

### Task 23: Compliance sees what is hidden and decides in the spec's words

**Files:**
- Modify: `src/server/services/workspace.ts`, `src/lib/format.ts`, `src/components/workspace/evidence-pane.tsx`, `src/components/workspace/finding-actions.tsx`, `src/components/workspace/findings-pane.tsx`, `tests/services/workflow.test.ts`, `tests/e2e/demo.spec.ts`

**Interfaces:**
- Produces: `FindingView` gains `hidden: "until_decided" | "kept_hidden" | "shown_on_release"` and `passages: { turnLabel: string; text: string }[]`; `OUTCOME_LABEL` becomes `cleared_for_research: "Unhide: cleared for research"`, `restricted_exclude: "Keep hidden"`, `restricted_escalate_to_legal: "Keep hidden and send to legal"`, `no_concern: "Unhide: no concern"`.

- [x] **Step 1: Write the failing tests.** Service: on `seedAnalyzed()`, every undecided finding has `hidden: "until_decided"`; after `dispose(F2, "restricted_exclude")` it is `kept_hidden`; after `dispose(F3, "no_concern")` it is `shown_on_release`; a `live` finding lists its passage text. Browser, added to the demo spec after F1 is selected: `await expect(page.getByTestId("hidden-status")).toHaveText("Hidden from the banker until you decide");`
- [x] **Step 2: Run them and see them fail.**
- [x] **Step 3: Implement.** The evidence pane shows one line under the title with `data-testid="hidden-status"`: "Hidden from the banker until you decide", "Hidden from the banker", or "Shown to the banker on release". A `live` finding is listed with the policy findings and labelled "Flagged during the call"; its passages show in place of linked quotes.
- [x] **Step 4: Run the tests.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/workspace.ts src/lib/format.ts src/components/workspace tests/services/workflow.test.ts tests/e2e/demo.spec.ts
git commit   # feat(workspace): show compliance what is hidden and let them keep or unhide it
```

### Task 24: The banker reads the released transcript and summary

**Files:**
- Create: `src/server/services/released.ts`, `src/app/api/analyst/releases/[id]/route.ts`, `src/app/analyst/[releaseId]/page.tsx`, `src/components/brief/released-transcript.tsx`, `tests/services/released.test.ts`
- Modify: `src/server/services/briefs.ts`, `src/app/api/analyst/briefs/route.ts`, `src/app/analyst/page.tsx`, `src/components/brief/released-brief.tsx`, `scripts/record-demo.ts` (it calls `releasedBriefs`), `tests/services/api.test.ts`

**Interfaces:**
- Produces:

```ts
export function releasedBriefs(tx: DbOrTx, actor: Actor): ReleasedBriefView[];       // gains the actor; a banker gets only cases they created, or releases to "investment_team"
export function releasedTranscript(tx: DbOrTx, releaseId: string, actor: Actor): { release: { id: string; caseTitle: string; releasedAt: string; standing: "current" | "superseded" | "under_re_review" }; turns: RedactedTurn[]; hiddenPassages: number };
```

- `GET /api/analyst/releases/:id` returns that object; 404 for a release the actor may not read.

- [x] **Step 1: Write the failing tests.**

```ts
it("the banker's transcript holds no restricted text, in any field", () => {
  const brief = reviewAndApprove(); release(brief.id);
  const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, user("priya")));
  for (const quote of restrictedQuotes()) expect(body).not.toContain(quote);
  expect(body).toContain("Distributors broadly are soft");
});
it("nothing is readable before release", () => expect(releasedBriefs(getDb(), user("priya"))).toEqual([]));
it("another banker cannot read it", () => expect(appError(() => releasedTranscript(getDb(), id, otherBanker)).status).toBe(404));
it("a release to the investment team is visible to every banker", () => { /* audience "investment_team" → otherBanker sees it */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/released.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.** The transcript comes only from `releases.redacted_transcript_json`; the service never reads `turns` for a banker. The page shows the summary's link "Read the transcript", then one line per turn; a blanked run is a bar with `aria-label="Hidden by compliance"` sized by its character count; a line above reads "N passages hidden by compliance." An "under re-review" release keeps showing its snapshot under a banner.
- [x] **Step 4: Run the tests.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/released.ts src/server/services/briefs.ts src/app/api/analyst src/app/analyst src/components/brief scripts/record-demo.ts tests/services/released.test.ts tests/services/api.test.ts
git commit   # feat(banker): let a banker read the released transcript with hidden passages blanked
```

---

## Phase 5: Security

### Task 25: Accounts and sessions

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/sessions.ts`, `tests/services/auth.test.ts`
- Modify: `src/server/db/schema.ts` (and a generated migration), `src/server/services/seed.ts`, `src/lib/session.ts`

**Interfaces:**
- Produces:

```ts
// schema: users gains email (text, unique, nullable) and password_hash (text, nullable)
// auth_sessions: id, token_hash (unique), user_id, created_at, expires_at, last_seen_at
// login_attempts: id, email, at, ok
export function hashPassword(plain: string): string;                    // "scrypt$16384$8$1$<salt b64>$<hash b64>", 16-byte salt, 64-byte key
export function verifyPassword(plain: string, stored: string | null): boolean;
export const AUTH_COOKIE = "blink_session";                             // in src/lib/session.ts
export const SESSION_TTL_HOURS = 12;
export function createSession(tx: DbOrTx, userId: string): { token: string; expiresAt: string };   // 32 random bytes, base64url; only its SHA-256 is stored
export function sessionActor(db: DbOrTx, token: string | undefined | null): Actor | null;
export function destroySession(tx: DbOrTx, token: string): void;
export function tooManyAttempts(db: DbOrTx, email: string): boolean;    // five failures for that email in the last fifteen minutes
export function recordAttempt(tx: DbOrTx, email: string, ok: boolean): void;
```

- Seeding: each demo user gets `email` `<first name>@blink.demo`; `password_hash` comes from the JSON in `BLINK_SEED_PASSWORDS` (`{"user_priya": "..."}`), and stays null for a user it does not name.

- [x] **Step 1: Write the failing tests.**

```ts
it("a password verifies only against its own hash, and the hash is not the password", () => { const h = hashPassword("correct horse"); expect(verifyPassword("correct horse", h)).toBe(true); expect(verifyPassword("wrong", h)).toBe(false); expect(h).not.toContain("correct horse"); expect(verifyPassword("x", null)).toBe(false); });
it("a session resolves to its user until it expires", () => { /* createSession → sessionActor(token).id; move the clock 12 h 1 min with setClockForTests → null */ });
it("the stored value is not the token", () => expect(sessionRow().tokenHash).not.toBe(token));
it("the sixth attempt after five failures is refused", () => { /* five recordAttempt(false) → tooManyAttempts true; sixteen minutes later → false */ });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/auth.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement** with `node:crypto` (`scryptSync`, `randomBytes`, `timingSafeEqual`, `createHash`). No new dependency.
- [x] **Step 4: Run the tests.** Run: `pnpm db:generate && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/auth/password.ts src/server/auth/sessions.ts src/server/db/schema.ts drizzle src/server/services/seed.ts src/lib/session.ts tests/services/auth.test.ts
git commit   # feat(auth): add password accounts and server-side sessions
```

### Task 26: Sign-in replaces the role switcher outside development

**Files:**
- Create: `src/server/auth/mode.ts`, `src/app/api/session/login/route.ts`, `src/app/api/session/logout/route.ts`, `src/app/login/page.tsx`, `src/components/app/login-form.tsx`, `src/components/app/account-menu.tsx`
- Modify: `src/server/auth/session.ts`, `src/app/api/session/act-as/route.ts`, `src/proxy.ts`, `src/components/app/app-header.tsx`, `src/components/app/role-gate.tsx`, `vitest.config.mts`, `package.json` (the `dev`, `demo`, `e2e:serve` scripts), `.env.example`, `tests/services/api.test.ts`, `tests/services/auth.test.ts`

**Interfaces:**
- Produces: `authMode(): "password" | "switcher"`. It is `switcher` only when `BLINK_AUTH_MODE=switcher` and either `NODE_ENV` is not `production` or `BLINK_ALLOW_SWITCHER=1`; otherwise `password`.
- `POST /api/session/login` `{ email, password }`: 200 `{ user }` and the `blink_session` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, 12 hours); 401 `BAD_CREDENTIALS` with one message for an unknown email and a wrong password; 429 `TOO_MANY_ATTEMPTS`.
- `POST /api/session/logout`: 200, session destroyed, cookie cleared.
- In `password` mode: `POST /api/session/act-as` is 404; `requireSessionActor` and `pageActor` read `blink_session`; a page request with no valid session redirects to `/login?next=<path>`.
- `optionalPageActor(): Promise<Actor | null>` in `src/server/auth/session.ts` never redirects. `AppHeader` uses it and shows only the name "Blink" when nobody is signed in, so `/login` and `/desktop/pill` cannot loop.

- [x] **Step 1: Write the failing tests**, switching mode with `vi.stubEnv`.

```ts
it("signing in sets an HttpOnly session and the session reaches the API", async () => { /* login as priya → 200; cookie attrs include HttpOnly and SameSite=Lax; GET /api/cases with that cookie → 200 */ });
it("a wrong password and an unknown email give the same answer", async () => { /* both 401 BAD_CREDENTIALS with equal messages */ });
it("the role switcher is gone in password mode", async () => expect((await call(actAs, null, { method: "POST", body: { userId: "user_marcus" } })).status).toBe(404));
it("a banker's session cannot be turned into a reviewer's by sending blink_user", async () => { /* session for priya plus cookie blink_user=user_marcus → workspace is still 403 */ });
it("in production the switcher needs an explicit allowance", () => { /* NODE_ENV production, BLINK_AUTH_MODE switcher, no BLINK_ALLOW_SWITCHER → authMode() is "password" */ });
```

- [x] **Step 2: Run it and see it fail.**
- [x] **Step 3: Implement.** Set `BLINK_AUTH_MODE: "switcher"` in `vitest.config.mts`; add `BLINK_AUTH_MODE=switcher` to the `dev` script and, with `BLINK_ALLOW_SWITCHER=1`, to `demo` and `e2e:serve`. The header shows the role switcher in `switcher` mode and an account menu with "Sign out" in `password` mode. The proxy only checks that a session cookie is present; the page's `pageActor()` does the real check and redirects.
- [x] **Step 4: Run the tests.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/auth src/app/api/session src/app/login src/components/app src/proxy.ts vitest.config.mts package.json .env.example tests/services/api.test.ts tests/services/auth.test.ts
git commit   # feat(auth): require sign-in wherever the role switcher is not explicitly allowed
```

### Task 27: Every request is checked for the case it touches

**Files:**
- Create: `src/server/auth/access.ts`, `tests/services/access.test.ts`
- Modify: `src/server/http/route.ts`, `src/server/services/cases.ts`, `src/server/services/transcripts.ts`, `src/server/services/sessions.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/cases/[id]/analyze/route.ts`, `src/app/cases/[id]/page.tsx`, `tests/services/api.test.ts`

**Interfaces:**
- Produces:

```ts
export function requireCaseAccess(db: DbOrTx, actor: Actor, caseId: string): CaseRow;
// reviewer, senior_reviewer: any case. analyst: only a case they created, otherwise notFound("case"). policy_owner: forbidden.
export function visibleCaseIds(db: DbOrTx, actor: Actor): Set<string> | "all";
```

- `api()` refuses a non-GET request whose `Origin` header names a different host than the request: 403 `BAD_ORIGIN`.

- [x] **Step 1: Write the failing tests.** Add a second banker in the test (`user_sam`, role `analyst`).

```ts
it("a banker's case list holds only their own cases", async () => expect(ids(await call(getCases, "sam"))).not.toContain(CASE));
it("a banker cannot open, upload to, or poll another banker's case", async () => { /* analystCaseView → 404; POST transcripts → 404; a job of that case → 404 */ });
it("a reviewer still sees every case", async () => expect(ids(await call(getCases, "marcus"))).toContain(CASE));
it("a request from another site is refused", async () => { /* POST with Origin: https://evil.example → 403 BAD_ORIGIN; the same with the app's own origin → not 403 */ });
```

- [x] **Step 2: Run it and see it fail.**
- [x] **Step 3: Implement.** Use `requireCaseAccess` in every service that takes a case id from a banker: `analystCaseView` (which now takes the actor), `uploadTranscript`, `requestReanalysis`, `heartbeat`, `startCall`, and the job route (resolve the job's case from its payload).
- [x] **Step 4: Run the tests.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add src/server/auth/access.ts src/server/http/route.ts src/server/services src/app/api/jobs src/app/api/cases src/app/cases tests/services/access.test.ts tests/services/api.test.ts
git commit   # feat(auth): check case ownership on every request and refuse cross-site writes
```

### Task 28: Break-in tests over every route

**Files:**
- Create: `tests/services/breakin.test.ts`

**Interfaces:**
- Consumes: every route under `src/app/api/`.

- [x] **Step 1: Write the test.** It lists every `route.ts` under `src/app/api` with `readdirSync` and fails if one is missing from the table below it. Each table row names the route file, the method, whether it is scoped to a case, and `noSession`, the status a caller with no session must get: 401 unless stated (400 for sign-in with an empty body, 404 for `act-as` and for the scripted-call route, 200 for the health check once Task 42 adds it). It runs in `password` mode on a database where a live call has been fed and ended, the case reviewed with two findings kept hidden, and the brief released.

```ts
it("every route file is in the table", () => expect(routeFiles().filter((f) => !TABLE.some((r) => r.file === f))).toEqual([]));
it.each(TABLE)("$method $file answers a caller with no session as the table says", async (r) => expect((await hit(r, null)).status).toBe(r.noSession ?? 401));
it.each(TABLE.filter((r) => r.caseScoped))("$method $file refuses another banker", async (r) => expect([403, 404]).toContain((await hit(r, "sam")).status));
it("no response to the owning banker contains hidden text, anywhere", async () => {
  for (const r of TABLE.filter((r) => r.method === "GET")) { const body = JSON.stringify((await hit(r, "priya")).json); for (const q of hiddenTexts()) expect(body, r.file).not.toContain(q); }
});
it("an error never repeats hidden text", async () => { /* force the release failure and the leak failure as marcus; then as priya read every route again → no hidden text */ });
```

`hiddenTexts()` returns every restricted quote, every `finding_passages` text, and every live `call_turns.text` that is part of a flagged claim.

- [x] **Step 2: Run it.** Run: `pnpm exec vitest run tests/services/breakin.test.ts`. Expected: every case PASS. Any failure is a real hole: fix the service, not the test.
- [x] **Step 3: Run the full checks.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 4: Commit.**

```bash
git add tests/services/breakin.test.ts
git commit   # test(auth): try to break in as a banker through every route
```

---

## Phase 6: Observability

### Task 29: One call's record and the all-calls overview, as data

**Files:**
- Create: `src/server/services/observability.ts`, `src/app/api/calls/[id]/route.ts`, `tests/services/observability.test.ts`
- Modify: `src/app/api/calls/route.ts` (add `GET`)

**Interfaces:**
- Consumes: `call_turns`, `call_claims`, `call_outages` (Task 9); `describeMoment`, `summarizeLatency`, `STAGES` (Task 8); `costUsd` (Task 10); `llm_calls`; `decisions`; `PILL_TEXT`.
- Produces:

```ts
export interface StepView { name: "Transcribed" | "Read" | "Rules checked" | "Shown" | "Hidden" | "Reviewed"; detail: string; decidedBy: "model" | "code" | "person" | null; meta: string | null; offsetMs: number | null; durationMs: number | null }
export interface MomentView { kind: "turn" | "outage"; seq: number | null; atMs: number; speaker: "Banker" | "Expert" | null; text: string; conclusion: string; level: "listening" | "amber" | "red" | "broken"; totalMs: number | null; steps: StepView[] }
export interface CallTraceView { call: { id: string; caseId: string; title: string; startedAt: string; durationMs: number | null; status: string }; counts: { turns: number; warnings: number; hidden: number; problems: number; costUsd: number | null; callsWithoutPrice: number }; stages: { stage: Stage; ok: boolean; note: string | null }[]; moments: MomentView[] }
export function callTrace(db: DbOrTx, callId: string, actor: Actor): CallTraceView;                    // reviewer and senior_reviewer only
export interface CallsOverview { latency: LatencySummary; calls: number; turns: number; turnsWithProblem: number; hidden: number; unhidden: number; typicalCostUsd: number | null; stages: { stage: Stage; ok: boolean; note: string | null }[]; problems: { at: string; callId: string; title: string; text: string }[]; recent: { callId: string; title: string; startedAt: string; turns: number; warnings: number }[] }
export function callsOverview(db: DbOrTx, actor: Actor): CallsOverview;                                // reviewer, senior_reviewer, policy_owner; no transcript text; `recent` is empty for the policy owner, who may not open a call
```

- `GET /api/calls` returns the overview; `GET /api/calls/:id` returns the trace.

- [x] **Step 1: Write the failing tests** on a database where `halvorsenLiveTurns()` were fed with `goldReader()`, one 19-second outage recorded, the call ended with `{ source: "gold" }`, the jobs drained, and the case reviewed with `completeReview()` (two findings kept hidden, one cleared).

```ts
it("one line per moment, in order, with the outage among them", () => { const t = callTrace(db, id, user("marcus")); expect(t.moments.map((m) => m.kind)).toContain("outage"); expect(t.moments.map((m) => m.atMs)).toEqual([...t.moments.map((m) => m.atMs)].sort((a, b) => a - b)); });
it("the red moment explains itself step by step", () => {
  const m = callTrace(db, id, user("marcus")).moments.find((m) => m.level === "red")!;
  expect(m.steps.map((s) => s.name)).toEqual(["Transcribed", "Read", "Rules checked", "Shown", "Hidden", "Reviewed"]);
  expect(m.steps[1]).toMatchObject({ decidedBy: "model" }); expect(m.steps[1].meta).toMatch(/claude-haiku-5-5 · prompt live-v1 · \d+ tokens in, \d+ out/);
  expect(m.steps[2]).toMatchObject({ decidedBy: "code" }); expect(m.steps[2].meta).toMatch(/policy .* approved by /);
  expect(m.steps[3].detail).toBe("“Sounds like inside information. Move on.”"); expect(m.steps[5].decidedBy).toBe("person");
});
it("an outage row says what was lost", () => expect(outageMoment().conclusion).toMatch(/^Blink could not hear the call for 19 seconds\. .* Speech in this gap is not in the transcript\.$/));
it("a call whose model has no known price reports an unknown cost, not zero", () => { /* set llm_calls.model to "x" → counts.costUsd null, callsWithoutPrice > 0 */ });
it("the overview uses percentiles and counts what compliance unhid", () => { const o = callsOverview(db, user("dana")); expect(o.latency).toEqual(summarizeLatency(shownMinusSpoken())); expect(o.unhidden).toBe(1); expect(JSON.stringify(o)).not.toContain("orders fell"); });
it("a banker is refused both", () => { expect(appError(() => callTrace(db, id, user("priya"))).status).toBe(403); expect(appError(() => callsOverview(db, user("priya"))).status).toBe(403); });
```

- [x] **Step 2: Run it and see it fail.** Run: `pnpm exec vitest run tests/services/observability.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.** `totalMs` is `shown_at` minus `speech_ended_at`, null until acknowledged. Step offsets: Transcribed from the end of speech to `transcribed_at`; Read `read_ms`; Rules checked `rules_ms`; Shown from the reply to `shown_at`. A turn's "problem" is any read status other than `read`. A stage is not ok when it has an outage on the call (or, for the overview, in the last hour). `problems` lists outages and not-read turns, newest first, at most ten. "Hidden" and "Reviewed" steps appear only on a turn whose claim was flagged; "Reviewed" reads the latest decision on the finding that covers it.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS. Add the two routes to the table in `tests/services/breakin.test.ts`.
- [x] **Step 5: Commit.**

```bash
git add src/server/services/observability.ts src/app/api/calls tests/services/observability.test.ts tests/services/breakin.test.ts
git commit   # feat(observability): assemble one call's record and the all-calls overview
```

### Task 30: The three observability screens

Follow the dataviz skill for the figures: one headline figure per view at 48 px or more in the same sans, proportional digits on standalone numbers, `tabular-nums` only in columns, status as a dot with a label.

**Files:**
- Create: `src/app/calls/page.tsx`, `src/app/calls/[id]/page.tsx`, `src/components/calls/call-trace.tsx`, `src/components/calls/moment-steps.tsx`, `src/components/calls/calls-overview.tsx`, `src/components/calls/time-bar.tsx`, `tests/e2e-live/calls.spec.ts`
- Modify: `src/components/app/app-header.tsx` (a "Calls" link for reviewer, senior reviewer and policy owner), `tests/helpers/ui-scope.ts`, `src/server/services/workspace.ts` (`WorkspacePayload` gains `callId: string | null`), `src/components/workspace/case-header.tsx` (a "Call record" link when `callId` is set)

**Interfaces:**
- Consumes: `callTrace`, `callsOverview` (Task 29); `StatusDot` (Task 4). Layout: sections 3, 4 and 5 of the mockups file.

- [x] **Step 1: Write the failing browser test**, which runs after the scripted call of `call.spec.ts` in the same database.

```ts
test("one call reads top to bottom, and the red moment opens into its steps", async ({ page }) => {
  await actAs(page, "user_marcus", "Marcus Lee");
  await page.goto("/calls"); await page.locator('[data-testid^="call-link-"]').first().click();
  await expect(page.getByTestId("call-counts")).toContainText("Turns heard"); await expect(page.getByTestId("stage-hearing")).toHaveAttribute("data-ok", "true");
  const red = page.locator('[data-testid^="moment-"][data-level="red"]').first(); await red.click();
  await expect(page.getByTestId("step-Read")).toContainText("claude-haiku-5-5"); await expect(page.getByTestId("step-Rules checked")).toContainText("By code, not a model");
  await expect(page.getByTestId("step-Shown")).toContainText("Sounds like inside information. Move on.");
});
test("the overview leads with the typical time from words to warning", async ({ page }) => {
  await actAs(page, "user_dana", "Dana Okafor"); await page.goto("/calls");
  await expect(page.getByTestId("hero-latency")).toHaveText(/^(\d+\.\d s|—)$/); await expect(page.getByTestId("hero-caption")).toContainText("19 in 20");
  await expect(page.getByTestId("stage-row").locator("[data-ok]")).toHaveCount(5);
});
test("a banker cannot open either screen", async ({ page }) => { await actAs(page, "user_priya", "Priya Raman"); await page.goto("/calls"); await expect(page.getByTestId("role-gate")).toBeVisible(); });
```

- [x] **Step 2: Run it and see it fail.** Expected: FAIL, 404 on `/calls`.
- [x] **Step 3: Build the one-call screen and the opened moment** (mockup sections 3 and 4): counts across the top; five stage dots; one row per moment with time, dot, what was said, the conclusion, and the total on the right; clicking a row opens its steps, each with a thin single-colour bar at its offset. A cost of null reads "unknown", with "N steps have no price" beneath when relevant.
- [x] **Step 4: Run the first and third tests.** Expected: PASS.
- [x] **Step 5: Build the overview** (mockup section 5): the headline figure with its caption "19 in 20 warnings arrive within X s. Slowest: Y s."; four tiles (calls, turns with a problem, unhidden by compliance, typical cost per call); stage status; recent problems, each a link to its call; then recent calls, one line each with `data-testid="call-link-<id>"`, shown only to the roles that may open a call. With no calls yet, the headline is "—" and the caption says so.
- [x] **Step 6: Look at it.** Screenshot both screens in light and dark at 1440 by 900 into `test-results/observability/` and check them against the mockups and the rules in Global Constraints. Fix what is off.
- [x] **Step 7: Run the checks.** Run: `pnpm test && pnpm e2e`. Expected: PASS.
- [x] **Step 8: Commit.**

```bash
git add src/app/calls src/components/calls src/components/app/app-header.tsx src/server/services/workspace.ts src/components/workspace/case-header.tsx tests/e2e-live/calls.spec.ts tests/helpers/ui-scope.ts
git commit   # feat(observability): show one call, one moment, and all calls
```

---

## Phase 7: Redesign

Each task restyles a group of existing screens to section 9 of the spec, adds its directories to `UI_RULE_SCOPE`, keeps every `data-testid`, and ends with screenshots in light and dark reviewed against the rules. No behaviour changes.

### Task 31: Queue, case intake, and the banker's pages

**Files:**
- Modify: `src/app/page.tsx`, `src/app/cases/new/page.tsx`, `src/components/cases/new-case-form.tsx`, `src/components/workspace/analyst-case.tsx`, `src/components/workspace/upload-transcript.tsx`, `src/app/analyst/page.tsx`, `src/components/brief/released-brief.tsx`, `src/components/ui/*.tsx`, `tests/helpers/ui-scope.ts`

- [x] **Step 1: Extend the scope and see the rule test fail.** Add `src/app/page.tsx`, `src/app/cases/new`, `src/components/cases`, `src/components/ui`, `src/app/analyst` and the three component files. Run: `pnpm exec vitest run tests/core/ui-rules.test.ts`. Expected: FAIL, listing literal colour classes.
- [x] **Step 2: Restyle.** The queue is one row per case: title, expert, call date, a `StateLabel`, open findings as plain counts, time in review. The three cards above it become one line of figures. The words "Banker" and "Bankers" replace "Analyst" in visible text.
- [x] **Step 3: Run the checks and look.** Run: `pnpm test && pnpm e2e`, then screenshot into `test-results/redesign/31/`. Expected: PASS, and the screenshots match the rules.
- [x] **Step 4: Commit.**

```bash
git add src/app/page.tsx src/app/cases/new src/components/cases src/components/ui src/app/analyst src/components/workspace/analyst-case.tsx src/components/workspace/upload-transcript.tsx src/components/brief/released-brief.tsx tests/helpers/ui-scope.ts
git commit   # style(ui): restyle the queue, intake and the banker's pages
```

### Task 32: The review workspace

**Files:**
- Modify: every file in `src/components/workspace/` not done in Task 31, `src/app/cases/[id]/page.tsx`, `tests/helpers/ui-scope.ts`

- [x] **Step 1: Extend the scope to `src/components/workspace` and see the rule test fail.**
- [x] **Step 2: Restyle.** Three panes and all content stay. Findings become one line each: label, a `StateLabel`, title, turns. Transcript highlights use one tint per state from tokens. The state path reads "Unassessed → Needs context at T5 → Review required at T11" in plain text.
- [x] **Step 3: Run the checks and look.** Run: `pnpm test && pnpm e2e`, screenshot into `test-results/redesign/32/`. Expected: PASS.
- [x] **Step 4: Commit.**

```bash
git add src/components/workspace src/app/cases tests/helpers/ui-scope.ts
git commit   # style(ui): restyle the review workspace
```

### Task 33: Brief and audit

**Files:**
- Modify: `src/components/brief/brief-workspace.tsx`, `src/app/cases/[id]/brief/page.tsx`, `src/components/audit/audit-timeline.tsx`, `src/app/cases/[id]/audit/page.tsx`, `src/components/baseline/baseline-review.tsx`, `src/app/cases/[id]/baseline/page.tsx`, `tests/helpers/ui-scope.ts`

- [x] **Step 1: Extend the scope and see the rule test fail.**
- [x] **Step 2: Restyle.** The release checklist is one line per check with a dot. The audit timeline is one line per event: time, who, what, a short hash in mono.
- [x] **Step 3: Run the checks and look.** Run: `pnpm test && pnpm e2e`, screenshot into `test-results/redesign/33/`. Expected: PASS.
- [x] **Step 4: Commit.**

```bash
git add src/components/brief src/components/audit src/components/baseline src/app/cases tests/helpers/ui-scope.ts
git commit   # style(ui): restyle the brief and the audit trail
```

### Task 34: Policy, documents, metrics

**Files:**
- Modify: `src/components/policy/*.tsx`, `src/app/policies/**`, `src/components/documents/document-card.tsx`, `src/app/documents/page.tsx`, `src/app/metrics/page.tsx`, `tests/helpers/ui-scope.ts`

- [x] **Step 1: Set the scope to all of `src/components` and `src/app`, and see the rule test fail.**
- [x] **Step 2: Restyle.** The monitor graph's nodes use tokens. The metrics page keeps its content; its cost column shows "unknown" where a model has no price.
- [x] **Step 3: Run the checks and look.** Run: `pnpm test && pnpm e2e`, screenshot into `test-results/redesign/34/`. Expected: PASS.
- [x] **Step 4: Commit.**

```bash
git add src/components/policy src/app/policies src/components/documents src/app/documents src/app/metrics tests/helpers/ui-scope.ts
git commit   # style(ui): restyle policy, documents and metrics
```

---

## Phase 8: Honest testing

The development set may be read and fixed against. The sealed set (the Einhorn call and Dotson) must never be opened in a session that edits prompts or rules. Do not fetch, read or summarise those two documents while executing this plan.

### Task 35: The real development set

**Files:**
- Create: `fixtures/real/dev/<id>/source.md`, `source.txt`, `transcript.txt`, `packet.json`, `expert.json`, `labels.json` for each of `gupta-horowitz`, `gupta-lau`, `kyprios-1`, `kyprios-2`, `chu`; `fixtures/real/README.md`; `tests/core/real-fixtures.test.ts`
- Modify: `tests/helpers/prompt-leak.ts`

**Interfaces:**
- Produces, per call: `source.md` (URL, date fetched, authority, page references, terms of use if stated); `source.txt` (the document's text, extracted); `transcript.txt` in the format `parseTranscript` reads, containing only words the document quotes, in the document's order; `packet.json` and `expert.json` in the shape of `fixtures/cases/halvorsen/`; `labels.json` as `{ "labels": [{ "turn": "T3", "authority_says": "inside_information", "cite": "<page or paragraph>" }] }`.

Sources: *US v. Gupta* (2d Cir. 2014), `https://www.govinfo.gov/content/pkg/USCOURTS-ca2-12-04448/pdf/USCOURTS-ca2-12-04448-0.pdf`; FSA final notice, Kyprios, `https://www.fca.org.uk/publication/final-notices/nicholas-kyprios.pdf`; the Justice Department's release on Chu, `https://www.justice.gov/archive/usao/nys/pressreleases/November10/chudonarrestpr.pdf`. The two scanned Justice Department complaints are included only if OCR with `tesseract` gives text whose quoted passages match the page images on a ten-quote spot check; otherwise say so in `fixtures/real/README.md` and leave them out.

- [x] **Step 1: Write the failing test.**

```ts
it.each(devCases())("%s: every transcript turn is in the source, word for word", (id) => {
  const src = squash(read(id, "source.txt"));
  for (const t of parseTranscript(read(id, "transcript.txt"), { filename: "t.txt" }).turns) expect(src.includes(squash(t.text)), `${id} ${t.label}`).toBe(true);
});
it.each(devCases())("%s: every label names a real turn and cites the authority", (id) => { /* labels[].turn exists; cite non-empty; authority_says is "inside_information" */ });
it.each(devCases())("%s: packet and expert parse as a case", (id) => { /* CreateCaseSchema.parse on the merged packet */ });
it("no sealed material is in the repository", () => expect(readdirSync("fixtures/real")).not.toContain("sealed"));
```

`squash` collapses whitespace and normalises curly quotes.

- [x] **Step 2: Run it and see it fail.** Expected: FAIL, no cases.
- [x] **Step 3: Build the five cases.** Fetch each document with the browser tool (not a scripted download: `sec.gov` and `justice.gov` refuse those), extract its text to `source.txt`, and copy the quoted dialogue into `transcript.txt` with the speakers the document names. The company, speakers, roles and dates in the packet come only from the document; a company's fiscal year end may come from its public filings, with the URL in `source.md`. A label is added only where the authority itself says the statement conveyed inside information.
- [x] **Step 4: Run the tests.** Run: `pnpm test`. Expected: PASS, including the prompt-leak test, which now reads these transcripts.
- [x] **Step 5: Commit.**

```bash
git add fixtures/real tests/core/real-fixtures.test.ts tests/helpers/prompt-leak.ts
git commit   # test(real): add a development set of real recorded calls with the authorities' labels
```

### Task 36: Three real policies

**Files:**
- Create: `fixtures/real/policies/oaktree.md`, `sage-rock.md`, `tcw.md`, each with a header naming the filing URL and date; `scripts/compile-real-policies.ts`; `docs/eval/2026-11-real-policies.md`
- Modify: `fixtures/llm-recordings/` (new recordings), `package.json` (`"eval:policies": "tsx scripts/compile-real-policies.ts"`)

**Interfaces:**
- Produces: a compiled policy bundle per file, reachable by `loadRealPolicy(name): CompiledPolicy` in `src/server/eval/real.ts`; a report listing, per policy, clauses found, rules written, clauses the ten predicates cannot express, and whether it validated.

The three were chosen on 2026-11-10, before any test call was opened: Oaktree (`https://www.sec.gov/Archives/edgar/data/2042513/000119312525055591/d923205dex99p14.htm`), Sage Rock (code of ethics, exhibit 99.(P)(19), filed 2021-07-29), TCW (exhibit 19.1). If one cannot be fetched, use Ardian US, then Bardin Capital, and say so in the report.

- [x] **Step 1: Fetch the three documents** with the browser tool and save the section on inside information and expert networks, verbatim, as numbered paragraphs.
- [x] **Step 2: Write the script.** For each file it calls `createPolicy` and `requestCompile` as the policy owner in a scratch database, drains the jobs, and prints status, attempts, rules and unsupported clauses. It exits 0 when each policy either validates or fails with listed validator issues, and 1 on any error that is not a validator issue.
- [x] **Step 3: Record.** Run: `BLINK_LLM_MODE=record pnpm eval:policies`. Expected: three results. Log the spend. A policy that does not validate is reported as it is: do not edit the policy text or the prompts to make it pass.
- [x] **Step 4: Check replay and write the report.** Run: `BLINK_LLM_MODE=replay pnpm eval:policies`. Expected: the same output, no network.
- [x] **Step 5: Commit.**

```bash
git add fixtures/real/policies scripts/compile-real-policies.ts src/server/eval/real.ts docs/eval/2026-11-real-policies.md fixtures/llm-recordings package.json
git commit   # test(real): compile three published firm policies with Blink's own compiler
```

### Task 37: The real-material harness, the development run, and repeat runs

**Files:**
- Create: `scripts/eval-real.ts`, `tests/services/eval-real.test.ts`, `docs/eval/2026-11-real-dev.md`, `fixtures/real/dev/<id>/coverage-<policy>.json`
- Modify: `src/server/eval/real.ts`, `package.json` (`"eval:real": "tsx scripts/eval-real.ts"`)

**Interfaces:**
- Produces:

```ts
export type TurnOutcome = "hidden" | "not_extracted" | "extracted_not_flagged";
export interface RealCaseScore { id: string; policy: string; labelled: number; hidden: number; notExtracted: string[]; extractedNotFlagged: { turn: string; covered: boolean | null }[]; otherHidden: number }
export function scoreRealCase(labels: { turn: string }[], claims: { turns: string[]; state: string }[], coverage: Record<string, boolean>): RealCaseScore;
export function runRealEval(opts: { dir: string; policies: string[]; countsOnly: boolean }): Promise<RealCaseScore[]>;
```

- `hidden`: a labelled turn quoted by a claim whose monitors end in `REVIEW_REQUIRED`, `ESCALATION_REQUESTED` or `NEEDS_CONTEXT`. `extractedNotFlagged[].covered` comes from the coverage file: `true` when the policy has a clause that applies (the file quotes it), `false` when it has none, `null` when not yet judged.
- `pnpm eval:real --set <dir> [--policies a,b] [--counts-only] [--repeat n]`. With `--counts-only` it prints numbers and call ids and never a word of transcript.

- [x] **Step 1: Write the failing test** for `scoreRealCase`: two labelled turns, one quoted by a flagged claim and one by an unflagged claim with coverage `false`, gives `{ labelled: 2, hidden: 1, notExtracted: [], extractedNotFlagged: [{ turn: "T4", covered: false }] }`; a labelled turn no claim quotes lands in `notExtracted`.
- [x] **Step 2: Run it and see it fail.**
- [x] **Step 3: Implement the scorer and the runner.** The runner creates a case from each call's packet, uploads its transcript, runs the after-call pipeline live under each policy, and scores.
- [x] **Step 4: Run the development set.** Run: `BLINK_LLM_MODE=live pnpm eval:real --set fixtures/real/dev --policies oaktree,sage-rock,tcw,demo`. `demo` is the demo policy, run for comparison only: it is reported in its own column and never counted against a pass bar. Log the spend.
- [x] **Step 5: Judge coverage.** For every `extracted_not_flagged` turn, read the policy and write `coverage-<policy>.json` with `{ "<turn>": { "covered": true | false, "clause": "<the clause, quoted, or 'none'>" } }`. No turn was extracted but not flagged in any run, so there was nothing to judge and no coverage file was written.
- [x] **Step 6: Fix what the run shows, within limits.** A turn that is `not_extracted`, or not flagged where the policy covers it, is a miss. Fix misses with general changes to prompts or predicates only: no text from the real material (the leak test enforces it), version bumps, re-recording, and all checks green. At most two rounds. Then run again.
- [x] **Step 7: Repeat runs.** Run: `BLINK_LLM_MODE=live pnpm eval:real --set fixtures/real/dev --policies oaktree --repeat 5` on the three shortest calls. Record whether each call gave the same hidden turns on at least four of five runs.
- [x] **Step 8: Write `docs/eval/2026-11-real-dev.md`.** Counts per call and per policy, never one percentage: labelled, hidden, not extracted, not flagged with a covering clause, not flagged without one, other passages hidden. Then the pass bars from section 11 with a plain yes or no for each, the repeat-run result, the spend, and what could not be measured (no stay-quiet set without In Practise's permission).
- [x] **Step 9: Commit.**

```bash
git add scripts/eval-real.ts src/server/eval/real.ts tests/services/eval-real.test.ts docs/eval/2026-11-real-dev.md fixtures/real/dev package.json
git commit   # test(real): score Blink on real calls, per call and per policy
```

### Task 38: The spoken path

**Files:**
- Create: `scripts/speak-call.ts`, `docs/eval/2026-11-spoken.md`
- Modify: `package.json` (`"eval:spoken": "tsx scripts/speak-call.ts"`)

**Interfaces:**
- Consumes: `createTurnAssembler` (Task 16); the call routes (Task 14); `say` and `ffmpeg` on the Mac.
- Produces: `pnpm eval:spoken --transcript <file> --case <caseId> [--server <url>] [--as <userId>]`, which reads each turn aloud with a different voice per speaker into two 16 kHz channels, streams them to Flux at real-time pace, posts turns exactly as the banker's app does, ends the call, and prints per turn: speaker, pill, read status, and milliseconds from end of speech to decision.

- [x] **Step 1: Write the script.** With `--as user_priya` it signs in through `/api/session/login` using that user's email and the password under that id in `BLINK_SEED_PASSWORDS`; without it, it uses the switcher cookie for `user_priya`. It never prints a password. It imports the pure assembler and never the browser modules.
- [x] **Step 2: Run it on the Halvorsen transcript locally.** Start `BLINK_LLM_MODE=live pnpm dev` on a fresh database with the manual policy, then run `pnpm eval:spoken --transcript fixtures/cases/halvorsen/transcript-v1.txt --case case_halvorsen`. Expected: the pill goes red on the turn that carries the source remark, and the call ends with a count.
- [x] **Step 3: Run it on each development call** under the Oaktree policy.
- [x] **Step 4: Check transcription on real audio.** Download two files of Earnings-21's ten-hour evaluation subset (`https://github.com/revdotcom/speech-datasets`, CC BY-SA 4.0), stream ten minutes of each through Flux, and compare with the reference transcript: word error rate, and separately the share of numbers and company names transcribed correctly.
- [x] **Step 5: Write `docs/eval/2026-11-spoken.md`.** Per call: turns, turns not read live, median, 95th percentile and worst time from end of speech to decision, and whether live flags matched the after-call read. Then the Earnings-21 figures, the Deepgram credit used, and the note that voices were synthetic and words real.
- [x] **Step 6: Commit.**

```bash
git add scripts/speak-call.ts docs/eval/2026-11-spoken.md package.json
git commit   # test(live): run real transcripts through the live path as speech
```

### Task 39: Ask In Practise for permission

**Files:**
- Create: `docs/eval/in-practise-request.md`

- [ ] **Step 1: Draft the request.** Three short paragraphs for the owner to send from their own address: who they are and what Blink is; the ask (use of the twenty free interviews, text and audio, for internal testing only, not redistributed, deleted on request); and how results would be reported (counts only, no quotation). Leave the recipient address for the owner to fill from `https://inpractise.com/about/compliance`.
- [ ] **Step 2: Commit.**

```bash
git add docs/eval/in-practise-request.md
git commit   # docs(eval): draft the permission request for a stay-quiet test set
```

- [ ] **Step 3 (owner): send it.** If permission arrives, the owner says so and the interviews are added as stay-quiet cases in a follow-up; until then the false-alarm bar stays unmeasured and the reports say so.

### Task 40: Freeze, and brief the sealed run

**Files:**
- Create: `docs/eval/sealed-brief.md`
- Modify: `docs/superpowers/plans/2026-11-10-live-guidance-notes.md`

- [ ] **Step 1: Check the tree is green.** Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e && pnpm demo:check && pnpm live:check`. Expected: all exit 0.
- [ ] **Step 2: Tag the freeze.** Run: `git tag eval-freeze-1`. From here, no prompt, predicate or rule changes until the sealed run is reported. Write the tag's commit hash in the notes file.
- [ ] **Step 3: Write `docs/eval/sealed-brief.md`** for a separate session that has not seen this work. It says: fetch the FSA final notice on Einhorn (`https://www.fca.org.uk/publication/final-notices/david-einhorn.pdf`) and *FINRA v. Dotson* (`https://www.finra.org/sites/default/files/OHO_Dotson_20090208031-02_080715.pdf`); build each as a case in the layout of `fixtures/real/README.md` under `~/.blink-sealed/`, outside the repository; label only what the authority itself says, with Dotson's right answer being "flagged for compliance"; check out the tag `eval-freeze-1`; do not open anything under `src/server/llm/prompts/`; run `BLINK_LLM_MODE=live pnpm eval:real --set ~/.blink-sealed --policies oaktree,sage-rock,tcw --counts-only` once; judge coverage for unflagged turns as Task 37 step 5 describes; write the counts to `docs/eval/2026-11-real-sealed.md` and nothing else from the material.
- [ ] **Step 4: Commit.**

```bash
git add docs/eval/sealed-brief.md docs/superpowers/plans/2026-11-10-live-guidance-notes.md
git commit   # docs(eval): freeze the build and brief the sealed run
```

### Task 41 (owner): The sealed run

- [ ] **Step 1 (owner): start a separate session** with `docs/eval/sealed-brief.md` as its whole brief, and let it finish. The session executing this plan must not do this step itself or read `~/.blink-sealed/`.
- [ ] **Step 2 (owner): commit its report** `docs/eval/2026-11-real-sealed.md`, or hand it to the executing session to commit unread beyond the counts.

---

## Phase 9: Deploy and demo

Do not start this phase before Phase 5 is complete: the app is not put on a public address without sign-in.

### Task 42: A production container and a health check

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.json`, `scripts/start-prod.sh`, `src/app/api/health/route.ts`, `scripts/smoke-deployed.ts`
- Modify: `package.json` (`"smoke": "tsx scripts/smoke-deployed.ts"`), `tests/services/breakin.test.ts` (the health route is the one public row), `scripts/seed.ts` (a `--users-only` flag that inserts or updates users and nothing else)

**Interfaces:**
- Produces: `GET /api/health` → 200 `{ ok: true }` when the database answers a trivial query, with no other field; `pnpm smoke --url <base>` reading passwords from `BLINK_SEED_PASSWORDS`.
- `scripts/start-prod.sh`: `drizzle-kit migrate`, then `tsx scripts/seed.ts` on an empty database or `--users-only` otherwise, then `concurrently -k -n web,worker "next start -p $PORT" "tsx scripts/worker.ts"`.
- `railway.json`: `{ "build": { "builder": "DOCKERFILE" }, "deploy": { "healthcheckPath": "/api/health", "restartPolicyType": "ON_FAILURE" } }`.

- [x] **Step 1: Write the smoke script.** It fails unless: `/api/health` is 200; `/` without a session redirects to `/login`; each of the four users can sign in; signed in as the banker, `GET /api/calls` is 403, `POST /api/session/act-as` is 404, and the workspace of a case they do not own is 403 or 404; sign-out ends the session.
- [x] **Step 2: Run it against a local production run and see it fail.** Run the app with `NODE_ENV=production BLINK_AUTH_MODE=password BLINK_SEED_PASSWORDS='{...}' BLINK_LLM_MODE=replay PORT=3200 sh scripts/start-prod.sh` after `pnpm build`, then `pnpm smoke --url http://localhost:3200`. Expected: FAIL, no health route.
- [x] **Step 3: Write the health route, the start script, the Dockerfile and `railway.json`.** The image is `node:26-bookworm-slim` with `python3`, `make` and `g++` for better-sqlite3, `corepack enable`, `pnpm install --frozen-lockfile` with development dependencies (the start script needs `tsx` and `drizzle-kit`), `pnpm build`, `NODE_ENV=production` set only after the install, and the start script as its command. `.dockerignore` excludes `.env*`, `data/`, `desktop/`, `spike/`, `test-results/`, `.next/`, `node_modules/`.
- [x] **Step 4: Run the smoke script again.** Expected: PASS.
- [x] **Step 5: Commit.**

```bash
git add Dockerfile .dockerignore railway.json scripts/start-prod.sh scripts/smoke-deployed.ts scripts/seed.ts src/app/api/health package.json tests/services/breakin.test.ts
git commit   # build(deploy): add a container, a start script and a health check
```

### Task 43: Deploy to Railway

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-11-10-live-guidance-notes.md`

- [x] **Step 1: Read the CLI's current commands.** Run `pnpm dlx @railway/cli --help` and check project, volume, variable, deploy and domain commands against Railway's documentation with context7. The token is `RAILWAY_API_TOKEN` in `.env.local`; export it for the commands without echoing it.
- [x] **Step 2: Create the project, one service, and a volume mounted at `/data`** (0.5 GB is the trial's limit).
- [x] **Step 3: Set the variables** without printing values: `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `BLINK_LLM_MODE=live`, `BLINK_AUTH_MODE=password`, `BLINK_DB_PATH=/data/blink.db`, `BLINK_LIVE_MODEL=claude-haiku-5-5`, `NODE_ENV=production`, and `BLINK_SEED_PASSWORDS` holding four passwords generated with `openssl rand -base64 18`. Write the same passwords to `.env.local` as `BLINK_SEED_PASSWORDS` so the smoke script and the owner can use them.
- [x] **Step 4: Deploy and get the address.** Deploy from the working tree with the CLI (not from GitHub: the repository belongs to someone else). Expected: the build finishes and the health check passes.
- [x] **Step 5: Smoke-test the deployment.** Run: `pnpm smoke --url <the address>`. Expected: PASS.
- [x] **Step 6: Record it.** Put the address in `README.md`; in the notes file write the trial's end date (2026-12-10), the credit used so far, and that the service should be stopped after the finals to save credit.
- [x] **Step 7: Commit.**

```bash
git add README.md docs/superpowers/plans/2026-11-10-live-guidance-notes.md
git commit   # docs(deploy): record the deployed address and the trial's limits
```

### Task 44: A full live run on the deployed app

**Files:**
- Create: `docs/eval/2026-11-deployed-run.md`

- [ ] **Step 1: Compile and approve the demo policy on the deployment**, signed in as the policy owner, through the pages. Expected: status Active. A live compile takes over two minutes.
- [ ] **Step 2: Create a case as the banker and run a spoken call against the deployment.** Run: `pnpm eval:spoken --transcript fixtures/cases/halvorsen/transcript-v1.txt --case <id> --server <address> --as user_priya`. Expected: red on the source remark, a count at the end.
- [ ] **Step 3: Finish the case as compliance through the pages:** decide every finding, attest, draft and approve the summary, release.
- [ ] **Step 4: Check both ends.** As the banker, the released transcript shows blanked passages and the summary; as compliance, `/calls` shows the call with its timings.
- [ ] **Step 5: Write `docs/eval/2026-11-deployed-run.md`:** what was run, the timings (median, 95th percentile, worst), anything that failed, and the spend.
- [ ] **Step 6: Commit.**

```bash
git add docs/eval/2026-11-deployed-run.md
git commit   # docs(eval): record a full live run on the deployed app
```

### Task 45: The demo script and the documents

**Files:**
- Create: `docs/demo-script.md`
- Modify: `README.md`, `HANDOFF.md`, `BLINK_BUILD_SPEC.md` (sections 1.4, 15 and 19: a one-line pointer to the design document and the demo script; no rewriting)

- [ ] **Step 1: Write `docs/demo-script.md`,** five minutes, around a live call: the approved policy; the banker starts a call from the Mac app with the pill at the top; the expert reads lines that reach amber and then red; the call ends with a count; compliance opens the case, sees what is hidden and why, keeps one hidden and unhides one, releases; the banker reads the blanked transcript and the summary; compliance opens the call's record and one moment. Each step lists what is on screen and one line to say. It names the fallbacks in order: a phone hotspot, then the recorded video.
- [ ] **Step 2: Update `README.md`:** what Blink does now, how to run it locally, how to build and open the Mac app, that the banker should wear headphones, the two sign-in modes, the new commands, the deployed address, and the limits (a handful of real test calls; no stay-quiet set; synthetic voices in the spoken test).
- [ ] **Step 3: Update `HANDOFF.md`:** state at the end of this plan, what is left, the open owner steps, and where the results are.
- [ ] **Step 4: Run every check.** Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e && pnpm demo:check && pnpm live:check`. Expected: all exit 0.
- [ ] **Step 5: Commit.**

```bash
git add docs/demo-script.md README.md HANDOFF.md BLINK_BUILD_SPEC.md
git commit   # docs: rewrite the demo around a live call and bring the documents up to date
```

### Task 46 (owner): Rehearse and record

- [ ] **Step 1 (owner): rehearse the demo twice** from `docs/demo-script.md` on the deployed app, with the person who will read the expert's lines.
- [ ] **Step 2 (owner): record a screen capture of one clean run** as the backup, on or before 2026-11-18.
- [ ] **Step 3, after the (owner) steps: note anything the rehearsal showed** in the notes file, and fix what can be fixed without changing prompts or rules.
