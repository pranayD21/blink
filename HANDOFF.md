# Handoff

Written 2026-11-10. State of `main` at commit `90d4aad`, plus this file.

Read this first, then the [README](README.md) for how to run things and [BLINK_BUILD_SPEC.md](BLINK_BUILD_SPEC.md) for what the product is meant to be.

## Summary

Blink is built to the spec and every exit check in the spec has been run and passes. It is **not finished** by the two bars the owner has since set:

1. **Real, not local.** "Done" means a run on real services: a hosted database, a deployed app, live model calls. Today it runs on one machine with a SQLite file and replays recorded model output.
2. **Good on data it has not seen.** The prompts and rules were tuned against the same nine fixtures they are scored on. The 10-of-10 eval result says nothing about new calls.

Both are open. Five questions for the owner are waiting; see [Open questions](#open-questions).

## The goal

The original instruction was to follow `BLINK_BUILD_SPEC.md` and fully implement it, working. Blink is a hackathon project (BBS × Ramp, finals 2026-11-19) for compliance review of expert-network calls:

- a firm's policy in plain language is compiled by a model into rules and state machines, validated by code, and approved by hash;
- a model extracts the expert's claims from a call transcript with exact quotes, and code checks every quote;
- code evaluates the claims against the policy and compares them with public documents;
- a reviewer decides each finding; a brief is drafted from what was not restricted and released after a server-side check;
- when evidence changes, exactly what depended on it reopens;
- everything is written to a hash-chained audit log.

The owner's later instructions, which now define the goal:

- "Completion looks like an actual run with real tools. Everything is real, nothing is local."
- "The goal is to make this very good. … The development of the entire product is overfit to what you already know and have seen in the test."

## What is done

### Built

All eleven scope items in section 1.3 of the spec, across the seven build phases:

- **Pure core** (`src/core/`): three-valued logic, the ten-predicate vocabulary, policy schema, validator with exhaustive enumeration, scenario runner, monitor reducer, the four workflows, quote validation, public-evidence comparator, hashing and staleness.
- **Server** (`src/server/`): SQLite schema, 20 service modules, a jobs table with a worker process, the LLM client with live, record and replay modes, prompts, the audit log.
- **API** (`src/app/api/`): 31 routes, role checks in the services, idempotency keys.
- **UI** (`src/app/`, `src/components/`): case queue, case intake, the three-pane review workspace, brief, audit, baseline, analyst, policy (seven tabs with state graphs), documents, metrics.
- **Fixtures and recordings**: the demo policy and its broken variant, the Halvorsen case with two transcript versions, eight edge cases, six documents, and 27 recorded model responses from `claude-opus-5-5`.

### Verified

| Check | Result |
|---|---|
| `pnpm test` | 353 unit and service tests pass |
| `pnpm e2e` | The ten demo steps pass in a browser against a production build |
| `pnpm demo:check` | The demo flow through the services matches the gold labels at every step, from recordings |
| `pnpm demo:offline` | `pnpm db:reset` and `pnpm demo` with all non-loopback network denied by a macOS sandbox, then the browser test: passes |
| Node 26 | All of the above pass on Node 26.13.0 in a fresh clone of `90d4aad` with no `.env.local` and no API key. They also pass on 24.10 |
| Live run | One full run with every model call live (19 calls, $1.24, no recordings) passed every gold check, on 2026-11-10. It went through the services, not the browser |
| `pnpm eval` | 10 of 10 expected findings on nine fixtures, none extra. **Overfit; see below** |

API spend so far is about $3.40.

## What is left

### 1. An honest evaluation (highest priority)

The owner raised this and it is correct. The evidence:

- **The prompts contain the test.** `src/server/llm/prompts/extract.ts` uses phrases from the test transcripts as examples: "I still have a login", "so it has clearly gotten worse since then", "At Halvorsen this quarter", "well before I left". `policy.ts` mirrors the demo policy's sentence structure. The extraction prompt was edited after seeing its output on the Halvorsen transcript, and the policy prompt was edited after the first compile failed the reviewer scenarios; both then passed.
- **One author wrote both sides.** The eight edge cases and their expected answers were written by the same agent that tuned the prompts.
- **The set is tiny and narrow.** Nine fixtures, ten expected findings, one fictional company. Seven of the eight edge cases are four turns long.
- **A known silent miss.** `company_specific_operating_metric` in `src/core/predicates/registry.ts` treats any metric outside a fixed list (orders, bookings, revenue, margin, pricing, inventory, headcount, guidance, capex) as "not an operating result". An expert reading customer churn off an internal dashboard would produce no finding.

There is no open dataset of expert calls labeled for compliance concerns; two searches found none. The plan agreed in outline, not yet started:

| Test | What it shows | Data |
|---|---|---|
| Blind cases, about 30 | Whether it catches concerns and stays quiet on harmless calls | To be written by someone who has not seen the prompts. Fact patterns can come from the SEC complaint in *SEC v. Longoria* (the Primary Global Research case), so the right answer is what the SEC alleged |
| Perturbation | Whether it learned the task or the fixture: rename the company, reformat, add filler turns, move the source remark far from the statement, and check the findings hold | Existing fixtures; no new labels |
| New policies | Whether the compiler works beyond one policy: compile, then compare the guard's truth table with a hand-written reference | Real adviser codes of ethics on EDGAR (Ardian US, Bardin Capital) |
| Public-evidence comparison | Whether the comparator is right on labels nobody here wrote | FinDVer (claims checked against 10-K and 10-Q filings) |
| False alarms, long and messy calls | Robustness | Public earnings-call transcripts (`jlh-ibm/earnings_call` is CC0) |
| Repeat runs | Whether the answer is stable: each case five times live | Any |
| Timed review | Whether the "30% faster" pitch holds: two or three people, with and without Blink | Blind cases; the app already times both modes |

Rules proposed to keep it honest:

1. Remove the fixture-derived examples from the prompts, then freeze prompts and rules. This changes the request hashes, so everything must be re-recorded (`pnpm record`, then `BLINK_LLM_MODE=record pnpm eval`); `tests/services/recordings.test.ts` fails until that is done.
2. Split the blind set: about 20 cases that may be inspected and fixed against, and 10 sealed ones run once at the end by the owner, who reports totals only.
3. Fix the pass bars before running. Proposed, not agreed: at least 90% of planted concerns found, no silent misses, at most one false finding per call, the same findings on four of five repeat runs.
4. Report counts per case, not one percentage.

Licences of the public datasets have not been checked, and the dataset repositories have not been opened.

### 2. Real services

Nothing is deployed. Proposed, not confirmed:

- **Database:** Turso (hosted SQLite). Keeps the schema and migration.
- **Hosting:** Railway, with the web app and the worker as two services.
- **Model:** the Anthropic API in live mode, with replay kept as a fallback switch.

The cost is in the code. Every service function is synchronous and takes a better-sqlite3 transaction (`transact(fn)` in `src/server/db/client.ts`). A hosted database needs an async client, so the services, job handlers, routes, seed and service tests all have to become async. Estimate: about a day, including re-running every test against the hosted database. The smaller change is one host with a persistent disk, keeping SQLite, which does not meet "nothing is local" for the database.

Do not provision anything before the owner confirms the services. Ask for credentials through the secure secret prompt, never in chat.

### 3. Smaller gaps

- **No live browser run.** The e2e test asserts the "Replayed" badge and uses 90-second job timeouts; a live compile takes over two minutes. It needs a live variant before it can drive a live server.
- **Live output varies.** The recorded compile enumerates 1,156 evidence combinations; the live run produced 1,168, because the model wrote one rule with two predicates instead of one. Both validate. Two live runs have passed on the current prompts. That is not a reliability figure.
- **The AI brief draft in replay** has a recording only for the demo script's exact decisions. Other decisions give a visible replay miss; "Template draft" is the fallback.
- **The claim field editor** edits the enumerated fields and the period's relative value. It does not edit fiscal year, quarter, or the value.
- **Sign-in** is a role switcher over four seeded users. Role checks are real; identity is not.
- **`pnpm db:reset`** deletes `data/blink.db` by a hardcoded path, and `drizzle-kit migrate` reads `BLINK_DB_PATH` only from the real environment, not from `.env.local`.
- **`pnpm demo:offline`** is macOS only (it uses `sandbox-exec`) and resets `data/blink.db`.

### 4. From the spec's own schedule

Rehearse, and record a screen capture of the demo as the backup the spec asks for (section 19), on or before 2026-11-18.

## Decisions made

### By the owner

- Commit in small checkpoints and push after each. Do not lose work.
- Prefer real services to local ones. Local is fine for the dev server and tests. Name the service before deploying anything.
- "Done" means a real run on real services, nothing local.
- The Anthropic API key lives only in `.env.local`, which is gitignored. It is never printed or committed.

### In the build, where the spec was silent or reality disagreed

| Decision | Why |
|---|---|
| One finding per claim, keyed `policy:<case>:<claim>` | A replayed evaluation updates the finding instead of adding another |
| Escalation is an open task for a senior reviewer; the finding stays `REVIEW_REQUIRED` | Nothing hides the finding. A reviewer who tries to dispose gets a 403 from the server |
| A conflict between two statements forces review even when the guard is false | The guard was evaluated on a field the expert contradicted |
| No finding for a claim the expert completes later in the same call | Turn-ordered evaluation passes through `NEEDS_CONTEXT` on the way to `NOT_TRIGGERED`. The steps are stored as history, but the reviewer is not asked to acknowledge a question the call answered |
| Policy findings are numbered before AI-suggested ones | So F1 to F3 are the findings the demo script names |
| The model emits a flat extraction form; code restores the nested one | The API rejected the nested, nullable schema: "compiled grammar is too large" |
| Pass B: a clarification clause is carried out by `open_context_task`; a rule triggered by a confidentiality signal uses `open_review` | The first wording made the model send everything to review. Asking an expert to clarify possibly confidential information invites more of it |
| Pass B: each condition a clause states gets its own predicate | The model dropped the confidentiality condition because another predicate's description implied it |
| Extraction: an inference from facts already extracted is not a new claim; at most two AI-suggested concerns | The first live run opened a finding on "so it has clearly gotten worse", and raised three concerns that restated the findings. **This edit was made against the test transcript and is part of the overfitting problem** |
| Record mode reuses a recording that exists; `BLINK_LLM_RERECORD=1` refreshes | An interrupted recording run resumes without paying twice |
| IDs are monotonic within a process | "Latest row" queries break ties on the id; a random tail made them flip within a millisecond |
| A failed release returns 409 with every failure, and the transaction still commits | The blocked attempt records the staleness it found and its own audit event |
| A released brief whose evidence changed stays visible as "under re-review" | The analyst already read it; hiding it would misstate what happened |
| The eval uses the hand-written policy and document facts | So a score moves only when extraction does |
| A nondeterministic monitor fails its scenarios instead of crashing the compile | The reducer throws on a tie; the validator has already reported it |
| The offline check uses a sandbox, not Wi-Fi off | It can run unattended without cutting the machine off. The script tests a raw IP as well as names, because a first sandbox profile blocked DNS but let IP connections through |
| Hand-labeled claims are refused in a production build unless `BLINK_ALLOW_GOLD=1` | They are a development aid |
| The data stays synthetic | Real expert-call transcripts are confidential and there is no legitimate source for them |

## Open questions

Waiting on the owner. None has been answered.

1. Are Turso and Railway acceptable, or is something else preferred?
2. Does sign-in need to be real too? The spec puts it out of scope.
3. Who writes the blind cases? It cannot be the agent that tuned the prompts. Suggested: the owner or teammates write five by hand; a model from a different provider, with no access to this repository, writes the rest from a sealed brief, and the owner spot-checks its labels.
4. May the public data be pulled (a FinDVer sample, five codes of ethics, ten earnings calls) and Blink run on it unchanged, for a few dollars of API time?
5. Are the proposed pass bars right?

## Picking this up

```bash
pnpm i
pnpm db:reset          # seeded database, eval replayed
pnpm dev               # http://localhost:3000, web and worker, replay mode
pnpm test && pnpm e2e  # everything that should stay green
```

- **Remote:** `https://github.com/pranayD21/blink.git`, branch `main`.
- **Local checkout:** `~/Documents/blink` on the owner's machine (moved there on 2026-11-10 from a scratch folder). Its `.env.local` holds the API key and sets replay mode. A new machine needs its own key for record or live mode; replay needs none.
- **Node 26** is not installed system-wide on that machine. An official build is unpacked at `~/.t3/scratch/2026-11-10-goal-follow-everything-in-the-67af752d/tools/node26/node-v26.13.0-darwin-arm64/bin`; put it first on `PATH` to use it. That is a scratch folder and may be cleaned up; any Node 26 install does the same job. `node_modules` in the checkout is built for Node 24.
- **Databases** under `data/` are disposable: `blink.db` (dev), `e2e.db`, `record.db`.

Where to look first:

| To understand | Read |
|---|---|
| What a prompt asks for, and where it leaks the test | `src/server/llm/prompts/extract.ts`, `policy.ts` |
| What the rules can and cannot express | `src/core/predicates/registry.ts` |
| How findings are created from monitor steps | `src/server/services/evaluation.ts` |
| How a new transcript version is reconciled | `src/server/services/analysis.ts`, `src/core/evidence/lineage.ts` |
| How staleness works | `src/server/services/staleness.ts`, `src/core/deps/staleness.ts` |
| The release check | `src/server/services/release.ts`, `src/core/workflow/brief.ts` |
| How the current eval scores | `src/server/eval/run.ts`, `scripts/eval.ts` |
| The whole demo as code | `scripts/record-demo.ts`, `tests/e2e/demo.spec.ts` |

Two rules that are easy to break:

- **Changing a prompt changes its request hash.** Re-record, or the offline demo fails with a replay miss. `tests/services/recordings.test.ts` catches this.
- **`src/core/` has no I/O, clock or randomness.** Keep it that way; the validator and the tests rely on it.
