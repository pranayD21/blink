# Blink on real calls: the development set (2026-11)

Spec section 11 asks how Blink does on real material. This is the development set: five calls quoted in court, regulator and Justice Department documents. Fixes to prompts may be made against this set. Each call ran through the after-call pipeline under three published firm policies and the demo policy, live on `claude-opus-5-5`. The counts are per call and per policy. **It is a small test: five labelled statements in five calls.** None of these numbers is production accuracy.

- **Public calls** (`fixtures/real/dev/`): `gupta-horowitz`, `gupta-lau`, `chu`.
- **Private calls** (`~/.blink-real-local/dev/`, never in git): `kyprios-1`, `kyprios-2`. They are reported by id and counts only.

## How it was run

`pnpm eval:real` (`scripts/eval-real.ts`, scorer and runner in `src/server/eval/real.ts`) works in a scratch database, for each call and each policy:

1. creates a case from the call's `packet.json` and `expert.json`;
2. uploads `transcript.txt`;
3. runs the `analyze_transcript` job, the same after-call pipeline the app runs: extraction, quote grounding, the public-evidence comparison and policy evaluation;
4. scores the call against `labels.json`.

Each (call, policy) pair is its own case with its own model call, so extraction varies from one pair to the next.

- **Hidden:** a labelled turn is hidden when a claim quotes it and that claim's monitors end in `REVIEW_REQUIRED`, `ESCALATION_REQUESTED` or `NEEDS_CONTEXT`. A guard conflict at any step counts as `REVIEW_REQUIRED`, as it does in the app.
  - The runs below read a conflict only on each monitor's last step. The rule was widened after review, and the scores could not be recomputed from the saved files, which hold no monitor steps.
  - The labelled counts cannot change: every labelled turn is either already hidden or quoted by no claim.
  - "Other passages hidden" could only rise. That has not been re-measured.
- **Not extracted:** no claim quotes the turn.
- **Not flagged:** a claim quotes the turn, but nothing flags it. `coverage-<policy>.json` then says whether the policy has a clause that covers it.
- **Other passages hidden:** unlabelled turns that a flagged claim quotes.

The scratch database has no public documents. So "is this already public" is unknown for every claim, and rules that hinge on it go to their indeterminate branch.

- **Real policies:** each is loaded with `loadRealPolicy(name, { allowCoverageGaps: true })`. It is put through the app's own validator but never approved, and the case is pointed at it directly. The app itself still refuses to approve any of them. Each was compiled with blocking coverage issues: **oaktree 10, sage-rock 7, tcw 10**, all `CLAUSE_DROPPED` (see `2026-11-real-policies.md`). A miss on a clause no rule carries counts as "the policy did not cover it".
- **`demo`:** the demo policy's labelled hand-written fallback (`fixtures/policy/manual-monitors-v1.json`). It was run for comparison only, it is shown in its own column, and it never counts against a pass bar.
- **Recordings:** none. Every run was `BLINK_LLM_MODE=live`, which writes no recordings. Private calls were run with `--counts-only`, which prints numbers, ids and turn labels only.

## Counts per call and per policy (final, after fix round 1)

Columns: labelled · hidden · not extracted · not flagged with a covering clause · not flagged without one · other passages hidden.

| Call | Labelled | oaktree | sage-rock | tcw | demo (comparison) |
|---|---|---|---|---|---|
| `gupta-lau` | 3 | 3 · 0 · 0 · 0 · 5 | 3 · 0 · 0 · 0 · 0 | 3 · 0 · 0 · 0 · 0 | 3 · 0 · 0 · 0 · 0 |
| `gupta-horowitz` | 0 | 0 · 0 · 0 · 0 · 5 | 0 · 0 · 0 · 0 · 5 | 0 · 0 · 0 · 0 · 5 | 0 · 0 · 0 · 0 · 5 |
| `chu` | 0 | 0 · 0 · 0 · 0 · 0 | 0 · 0 · 0 · 0 · 0 | 0 · 0 · 0 · 0 · 0 | 0 · 0 · 0 · 0 · 0 |
| `kyprios-1` (private) | 1 | 1 · 0 · 0 · 0 · 3 | 1 · 0 · 0 · 0 · 3 | 1 · 0 · 0 · 0 · 3 | 1 · 0 · 0 · 0 · 3 |
| `kyprios-2` (private) | 1 | 1 · 0 · 0 · 0 · 0 | 1 · 0 · 0 · 0 · 0 | 1 · 0 · 0 · 0 · 0 | 1 · 0 · 0 · 0 · 0 |
| **All five** | **5** | **5 · 0 · 0 · 0 · 13** | **5 · 0 · 0 · 0 · 8** | **5 · 0 · 0 · 0 · 8** | **5 · 0 · 0 · 0 · 8** |

No turn ended up extracted but not flagged, so no coverage judgement was needed (Step 5). No `coverage-<policy>.json` file was written.

### Before the fix (first run, Step 4)

Before the fix, the public calls gave the same counts as above, except one. `gupta-horowitz` under tcw and under demo hid 4 other passages, not 5; that is the variation between runs. Both private calls produced **no claims at all** under every policy:
- `kyprios-1`: 1 labelled, 0 hidden, 1 not extracted;
- `kyprios-2`: 1 labelled, 0 hidden, 1 not extracted.

So the totals were **5 labelled, 3 hidden, 2 not extracted** under every policy.

### What the counts mean

- **`gupta-lau`:** all three labelled statements were hidden under every policy. Oaktree also hid the five earlier turns, which are market commentary. Under oaktree every claim on this call ended `REVIEW_REQUIRED`. The likely cause is oaktree's compiled R3: its guard is `analyst_solicited` alone, and its indeterminate branch opens review, so any statement the analyst asked for is flagged. That is the compiled policy being broader than its written intent ("company-specific nonpublic detail"). It is not an extraction miss.
- **`gupta-horowitz`:** no labels. The court cites these statements as admissions, not as inside information conveyed. Under every policy, one claim, linked across five turns, was flagged, so the call is not "nothing flagged".
- **`chu`:** no labels. The authority faults the conduct, not a passage. Extraction found no claim in the four turns, under any policy, so nothing was flagged.
- **`kyprios-1`:** the labelled turn was hidden. The one claim that carries it also quotes the three turns before it as context, and those are hidden too.

## Step 6: what was fixed (one round)

- **The miss:** both private labelled turns were `not_extracted`. In each, the expert conveys the information without stating it as a fact. The extraction prompt asked only for factual assertions, and it told the model to skip remarks about the call itself, so neither turn was extracted.
- **Why the change is general:** confirming, denying or correcting what the analyst put forward, or hinting at an event without stating it, is a standard way information passes on an expert call. It is independent of these calls. The new paragraph in `EXTRACT_SYSTEM` describes that pattern in general terms. It contains no text from the real material; the prompt-leak test checks five-word runs against every real transcript, private ones included. The paragraph tells the model:
  - to record the fact the exchange conveys, and say that it was signalled;
  - to quote the expert's reply as primary;
  - to fill only the fields the exchange establishes, and list the inferred ones as ambiguous.
- **What changed:** `extract-v2` became `extract-v3`. `FIELD_GUIDE` is unchanged, so the live reader's prompt is unchanged.
  - Re-recorded: `pnpm record`, `BLINK_LLM_MODE=record pnpm eval` and `pnpm record:live`. The 11 `extract-v2` recordings and the 2 brief recordings they fed were deleted.
  - `demo:check` and `live:check` pass. `pnpm eval` finds 10 of 10 expected findings, 0 extra, with 41 of 41 quotes valid. `pnpm test` passes, the leak test included.
- **Result:** both private labelled turns are hidden under every policy, and the public calls did not change.
- **No second round.** No labelled turn is still missed. `chu` fails a pass bar (below), but it has no labelled turn to fix against. Its turns state no fact about a company. Flagging talk about avoiding regulators or written records would need a new kind of claim or predicate, which is a design change, not a fix within these limits. It is recorded as it is.

## Repeat runs (Step 7)

`--policies oaktree --repeat 5` was run on the three shortest calls, by word count: `kyprios-2` (15 words), `kyprios-1` (57) and `chu` (111). Each run made fresh live model calls.

| Call | Labelled turn hidden | Same hidden turns |
|---|---|---|
| `chu` | n/a (no label) | 5 of 5 (nothing hidden) |
| `kyprios-1` | 5 of 5 | 5 of 5 |
| `kyprios-2` | 5 of 5 | 4 of 5 (one run also hid the call's other turn) |

## Pass bars (spec section 11)

| Bar | Result | Answer |
|---|---|---|
| At least 90% of the passages an authority identified are hidden | 5 of 5 under oaktree, sage-rock and tcw (3 of 5 before the fix) | **Yes** |
| No call the authority faulted comes back with nothing flagged | `chu` came back with nothing flagged under every policy; the other four were flagged | **No** |
| At most one hidden passage per stay-quiet call | No stay-quiet set | **Not measured** |
| The same result on four of five repeat runs | 5/5, 5/5 and 4/5 | **Yes** |

Five labelled statements is far too few to tell "90%" from "80%". The first bar's "yes" means the five that exist were all hidden.

## What could not be measured

- **False alarms.** Without In Practise's written permission there is no real "should stay quiet" set, so the third bar cannot be measured. "Other passages hidden" above is not a false-alarm rate either: the authorities label only what they relied on, so an unlabelled turn may or may not be a problem.
- **The comparison with public documents.** The scratch database has no document set for these companies, so every "already public" check was unknown.
- **The live path.** Only the after-call pipeline ran. Section 11's audio run of each call is a separate task.
- **The sealed set** (Einhorn, Dotson) was not opened. It is run once, at the end, by a separate session.

## Spend

All runs used `claude-opus-5-5`, live. Each row is what `llm_calls` reports for that run. The exception is the `pnpm eval` part of the re-recording, which is an estimate: the eval prints no cost, so it was priced from its recordings' token counts with `costUsd`.

| Run | Dollars |
|---|---|
| Probe: `gupta-lau` under oaktree | $0.24 |
| Step 4: public set, four policies | $1.15 |
| Step 4: private set, four policies | $0.11 |
| Fix round 1: private set again | $0.37 |
| Fix round 1: re-recording (`pnpm record` $0.37, `record:live` $0.18, `pnpm eval` about $0.31) | $0.86 |
| Fix round 1: public set again | $1.10 |
| Step 7: 3 calls × 5 runs, oaktree | $0.53 |
| **Total** | **$4.36** |
