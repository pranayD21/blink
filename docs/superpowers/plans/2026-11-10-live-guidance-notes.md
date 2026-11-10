# Live guidance: notes

Measured numbers, verdicts, the spend log, and what is waiting on the owner. Append to it; do not rewrite other tasks' sections.

## Spike: speed

Task 2, 2026-11-10. Measured from this machine (macOS, home network) against the real services. Scripts and clips live in the git-ignored `spike/` folder.

**Flux end-of-turn delay**: from the moment the last speech frame was sent to the moment `EndOfTurn` arrived. Three clips of about fifteen words made with `say`, each sent in 80 ms frames at real-time pace (a frame leaves when its audio has finished), followed by two seconds of silence. URL: `model=flux-general-en`, `eot_threshold=0.8`, `eot_timeout_ms=7000`. Ten runs per clip, 30 in all, no errors, every `EndOfTurn` came from the model (`trigger: model`), and every transcript was correct.

| | median | 95th percentile | worst |
|---|---|---|---|
| Flux, all 30 runs | 1.77 s | 2.05 s | 2.06 s |
| clip 1 (5.1 s) | 1.73 s | 1.90 s | 1.90 s |
| clip 2 (5.3 s) | 1.65 s | 1.80 s | 1.80 s |
| clip 3 (6.3 s) | 2.05 s | 2.06 s | 2.06 s |

The delay is almost all Flux waiting for its end-of-turn confidence to climb past the threshold: in a diagnostic run, confidence rose from 0.05 to 0.81 over the first 1.7 s of silence and `EndOfTurn` fired as soon as it crossed 0.8. Extra check with `eot_threshold=0.6` (five runs per clip, 15 in all): median 1.60 s, 95th percentile 1.93 s, worst 1.93 s. A lower threshold helps by about 0.2 s, not by the 1 s needed. Caveat: the clips are synthetic speech followed by digital silence; a real call has room noise and may behave differently, which Task 20 will show.

**Reader time**: `claude-haiku-5-5` through the SDK, non-streaming `beta.messages.create`, 30 sequential calls, `thinking: { type: "disabled" }`, `output_config: { effort: "low", format: <JSON schema, 25 flat enum and string fields, all required> }`, `max_tokens: 2000`, no `fallbacks`, a fixed system prompt (about 2,466 cached tokens including the schema) with `cache_control: { type: "ephemeral" }`, and a different one-sentence user turn each time. Request to complete:

| | median | 95th percentile | worst |
|---|---|---|---|
| Haiku 5.5 reader, 30 calls | 1.82 s | 2.72 s | 3.32 s |

The worst call was the first (it wrote the cache); without it the 29 warm calls give median 1.82 s, 95th percentile 2.63 s, worst 2.72 s. Every call ended with `end_turn` (no refusal, no truncation) and returned valid JSON. Output was 206 to 288 tokens per call, so the time is mostly the output the 25-field form asks for.

**Cache reads**: above zero on every call from the second on (29 of 29, 2,466 tokens each); the first call wrote the cache. Caching works but saves money, not much time.

**Against the targets** (1.0 s typical, 2.0 s for 19 turns in 20):

| | Flux | Reader | Sum | Target |
|---|---|---|---|---|
| medians | 1.77 s | 1.82 s | 3.59 s | 1.0 s |
| 95th percentiles (added, so an upper bound) | 2.05 s | 2.72 s | 4.77 s | 2.0 s |

Flux alone already uses the whole 2.0 s budget with these settings, and the reader alone is over it. The sum of the 95th percentiles is 2.4 times the target.

verdict: haiku-slow

What this does and does not say: the verdict is for Haiku 5.5 with this form size and Flux with the plan's `eot_threshold=0.8`. Two levers sit inside the plan and were not tried here: a smaller form (fewer fields means fewer output tokens), and starting the reader on `EagerEndOfTurn` instead of waiting for `EndOfTurn` (Flux's `eager_eot_threshold`). Either could cut a second or more, and neither needs a different vendor. They are for the owner and the next planning step to weigh, not something this spike decided.

## Spike: Mac app

Task 3 Step 1, 2026-11-10. The app is built and packaged; what it can hear is not yet known. Steps 2 to 5 wait on the owner (below). Nothing in this section is a measurement yet.

**What was built.** A throwaway Electron 45.2.3 app (latest stable), packaged with `@electron/packager` 20.3.0 for Apple silicon, bundle id `dev.blink.spike`, ad-hoc signed with `codesign --force --deep --sign -` (verified with `codesign --verify --deep --strict`). `NSAudioCaptureUsageDescription` and `NSMicrophoneUsageDescription` are in its `Info.plist`. Source is in the git-ignored `spike/mac/` (`main.js`, `pill.html`, `control.html`, `preload.js`). A self-test (`--selftest`) was run on the packaged app: both windows were created, it printed `pillAlwaysOnTop: true`, pill bounds 600 by 56 at the top centre of the main display, and exited 0. That proves the app launches and the pill window is set up; it does not prove the pill stays above Zoom, and it did not touch the microphone or system audio.

The app has two windows:
- **The pill**: a red rounded bar reading "Sounds like inside information. Move on.", 600 by 56, top centre, on top of everything, visible on every Space and over full-screen apps, ignoring the mouse (clicks go through it). It cannot be focused or dragged.
- **The control window** ("Blink Spike"): three buttons, a track list, a level meter per channel, a summary and a log. `Start` asks for the microphone, then runs `getUserMedia({ audio: true })` and `getDisplayMedia({ video: true, audio: true })`; the app answers the second with `{ video: <first screen>, audio: "loopback" }`. `Start (system audio only, no video)` does the same but the app answers `{ audio: "loopback" }` with no `video`, which is the Step 3 question about Screen Recording permission. `Stop` ends the tracks.

**For the owner (Step 2), about ten minutes.**

App: `/Users/shaunikm/Documents/blink/spike/mac/dist/Blink Spike-darwin-arm64/Blink Spike.app`

1. Open it with Finder (open the `dist/Blink Spike-darwin-arm64` folder and double-click "Blink Spike"), or in Terminal run `open "/Users/shaunikm/Documents/blink/spike/mac/dist/Blink Spike-darwin-arm64/Blink Spike.app"`. Do not run the inner `Contents/MacOS/Blink Spike` file from Terminal or an IDE: macOS would then credit the permission to the Terminal, not to this app, and the system-audio track would be silently dead. If macOS says the app cannot be opened because it is from an unidentified developer, right-click it, choose Open, then Open again.
2. Two windows appear: a red pill at the top centre of the screen and the "Blink Spike" window.
3. In the "Blink Spike" window click **Start**. Two permission prompts may appear; allow both:
   - **Microphone**: click Allow.
   - **System Audio Recording**: if a prompt appears, click Allow. If none appears and the System row stays dead, open System Settings > Privacy & Security > Screen & System Audio Recording, scroll to the "System Audio Recording Only" list (it may be the second list on the page), switch **Blink Spike** on (use the + button to add it if it is not listed), then quit the app (Cmd+Q) and open it again; macOS needs a restart of the app after a change.
   - If macOS also asks for **Screen Recording**, allow it for now, and write down that it asked.
4. Check the Tracks line: the `mic` row and the `system` row should both say `readyState=live`. Write down what each says.
5. Open the Zoom app, then `https://zoom.us/test` and join the test meeting. Play the speaker test (the ringtone and the sample) with the laptop speakers, not headphones, and watch the two level meters in the "Blink Spike" window.
6. While the speaker test plays, look at the Summary lines: they give how loud the system audio was, and how loud the microphone was in the same moments.
7. With Zoom windowed, look at the pill: is it above the Zoom window? Then put Zoom full screen (green button, or Ctrl+Cmd+F), move your pointer to the top and check again, and try switching to another Space with a swipe. Write down whether the pill stayed on top each time. Click on the pill once: the click should pass through to Zoom.
8. Click **Stop**, then **Start (system audio only, no video)**, play the Zoom speaker test again and note whether the system track is `live` and the level meter moves. If it fails, the Log box says why (for example `getDisplayMedia FAILED`). If this button makes macOS ask about Screen Recording, note that too.
9. The same log is written to `/tmp/blink-spike-mac.log` (every line has a time); you can send that file instead of copying from the window.

**What to report back (Step 3 asks for these five, plus one):**
1. Is the system-audio track `live`, with a moving level, while Zoom plays? (Step 3, question 1)
2. Is the microphone track `live`? (question 2)
3. Does the pill stay above Zoom windowed and full screen? (question 3)
4. In the "system audio only, no video" run, does audio still arrive? Which prompts did macOS show for each button, in particular was Screen Recording asked for? (question 4; this decides `audio grant: audio-only` against `audio grant: needs-video`)
5. With laptop speakers, how much of the far side reaches the microphone channel? Send the two "average ... level in those moments" lines from the Summary box. (question 5)
6. Anything odd: a prompt that never appeared, a restart you needed, the pill flickering or covering Zoom's buttons.

When the owner has reported, the next step is to fill in the answers here, write `verdict: mac-app` or `verdict: fallback`, write `audio grant: audio-only` or `audio grant: needs-video`, and commit (Task 3 Steps 3 to 5).

## Task 5: prompt cleanup

- Every prompt now passes the five-word leak test (`tests/core/prompt-leak.test.ts`) with an empty `ALLOWED` list. The demo and all nine eval fixtures kept their outcomes on the first re-record (10 of 10 expected findings, 0 extra, 41 of 41 quotes valid; `pnpm demo:check` passes), so no improvement rounds were needed.
- Deviation, wider than the brief's two prompt files: `brief.ts` (hedge examples taken from transcript T19) and `docfacts.ts` (the 10-Q's "$412 million" and "second quarter of fiscal 2027", and "Backlog is other") also quoted fixtures, so their examples were replaced too and their versions bumped to `brief-v2` and `docfacts-v2`. The predicate descriptions in `src/core/predicates/registry.ts` go to the Pass B model as the vocabulary, and three of them repeated paragraph 2 and 3 of the demo policy or transcript phrases, so they were reworded; the leak test covers them through `buildPassBUser`'s fixed text.
- Review fix round 1:
  - The predicate `phrase` strings reach the assembly and scenario models inside `guard_in_english`. Four of them repeated the demo policy, so they were reworded in plain terms: "the statement gives an operating figure for one company", "the expert credits an internal company source", "the expert has worked at the covered issuer in the past {months} months", "the expert marks the information as secret or unreleased". One clarifying question was reworded too.
  - The leak test now covers every phrase, every clarifying question, and the curated documents in `fixtures/documents/`. No chance matches appeared, so `ALLOWED` is still empty.
  - The docfacts example "the third quarter of fiscal 2031" matched the 10-Q by chance and became "Q3 of fiscal 2031" (`docfacts-v3`).
  - The phrase change bumped `assemble-v2` and `scenarios-v2`. Only the docfacts, assembly and scenario recordings were re-made; the demo and the nine eval fixtures kept their outcomes.
  - A metric in category `other` at unspecified scope is now unknown as well (controller ruling).

## Spend log

| Date | Task | What ran | Dollars |
|---|---|---|---|
| 2026-11-10 | 2 | Anthropic: 30 `claude-haiku-5-5` calls, about 1.0k uncached input, 71k cache-read, 2.5k cache-write, 7.4k output tokens (cache write priced at an assumed 1.25 times input) | $0.005 |
| 2026-11-10 | 2 | Deepgram Flux: about 47 real-time streams of 7 to 8 s each, roughly 6 minutes of audio (estimate at the pay-as-you-go streaming rate; the console shows the exact figure) | about $0.05 |
| 2026-11-10 | 5 | Anthropic: re-recorded every fixture after the prompt cleanup, one round. `pnpm record` made 19 live `claude-opus-5-5` calls ($1.19, as the script reports); `BLINK_LLM_MODE=record pnpm eval` added 8 extraction calls (about $0.32). Total from the 27 recordings' token counts priced by `costUsd` | $1.51 |
| 2026-11-10 | 5 (fix round 1) | Anthropic: re-recorded only the stages whose request text changed: 10 live `claude-opus-5-5` calls (6 docfacts, 3 assembly, 1 scenarios), as `pnpm record` reports; the eval reused every recording | $0.43 |
| 2026-11-10 | 17 | Anthropic: `pnpm record:live`, two runs. Run 1 (2.5 s limit): 11 `claude-haiku-5-5` reads completed and 11 timed out (aborted; their partial cost is not reported), plus 1 `claude-opus-5-5` after-call extraction, $0.200 as the script reports. Run 2 (record-mode limit 30 s): 19 Haiku reads, $0.007; the extraction and 3 reads were reused. 8 recordings left orphaned by run 1 were deleted | about $0.21 |

## Waiting on the owner

- Task 2 Step 5: the verdict is `haiku-slow`, so the owner decides whether to take Groq out of the backlog (spec section 6). Until they answer, the plan continues with Haiku 5.5.
- Task 3 Step 2: open the packaged app at `/Users/shaunikm/Documents/blink/spike/mac/dist/Blink Spike-darwin-arm64/Blink Spike.app`, press Start, allow Microphone and System Audio Recording, play the Zoom test meeting's speaker test. Instructions are in "Spike: Mac app".
- Task 3 Step 3: waits on Step 2. The answers (system track live, mic track live, pill above Zoom, audio without video, far-side level in the mic) are filled in from the owner's report.
- Task 3 Step 4: waits on Step 3. Writes `verdict: mac-app` or `verdict: fallback` and `audio grant: audio-only` or `needs-video`; Tasks 18 and 19 read them (Task 18 assumes `needs-video` until then).
- Task 3 Step 5: waits on Step 4. Commit the notes as `docs(spike): record what the Mac app can hear and show`.
- Task 19: not built, because the spike has no verdict yet. If the spike's Step 4 writes `verdict: fallback`, Task 19 (the Chrome picture-in-picture pill) must be built then; with `verdict: mac-app` it is not needed.
- Task 20 Step 2: hold the five-minute call. Steps are in "Task 20: first real call".
- Task 20 Step 3: waits on Step 2. After the call, tell the agent; it reads the record back from `call_turns` (turn count, turns not read live, median, 95th percentile and worst of `shown_at` minus `speech_ended_at`, whether the pill went red where expected) and writes it in the notes against the targets.
- Task 20 Step 4: waits on Step 3. Commit the notes as `docs: record the first real call's timings`.

## Task 10: the time limit is enforced twice

The SDK's per-request `timeout` stops counting once the response headers arrive, and a streamed answer sends them at once, so on its own it would not bound a stalled stream. `structuredCall` therefore passes `timeout` to the SDK and also runs its own deadline (an `AbortController` fired after `timeoutMs`) over the whole stream; either one raises `LlmTimeout`. A test stalls a stubbed stream after the headers and checks this.

## Task 11: what the live reader returns

- `rejected` lists more than claims with an invented quote. A claim that grounds on its earlier quotes but has no valid quote from the newest turn is also listed, with a reason: "its quote from the newest turn was not found" when the model gave a quote from the newest turn that failed grounding (an invented quote on a re-emitted claim, which is Review Focus 4), or "no quote from the newest turn" when the model only repeated an old claim. Each entry carries its reason, so Task 12 can store `rejected_json` as it is.
- Corrections of earlier claims are carried over. Grounding sees only one turn's output, so it drops any link or `is_correction_of` that points at a claim read on an earlier turn. `readTurn` rebuilds them from the model's output and accepts a target that is either a claim returned in this read or a key in `claimsSoFar`. A target that is neither is dropped and reported as a `LINK_TARGET_MISSING` issue with `ref: { claim, target }`. The read result has an `issues` list (grounding issues plus these), so Task 12 can store them.
- A refused read has `llmCallId: null`. `structuredCall` writes an `llm_calls` row for the refusal, but the `LlmRefusal` it raises does not carry that row's id. Timeouts and errors also have `llmCallId: null`.

## Task 12: what a turn's record holds

- `call_turns.rejected_json` is the read's `rejected` list as returned. The read's `issues` go in `evaluations_json`, which is an object, not a list: `{ policyVersionId, claims: [{ logicalKey, publicMatch, monitors: [{ monitorId, ruleId, prevState, nextState, result, transitionId, conflictFlag, guardTrace }] }], probe: { question, ruleIds } | null, issues }`. `probe` is set only on an analyst turn that was read.
- `call_claims.monitor_states_json` is a list of `{ monitorId, ruleId, state }`. `rule_ids_json` holds the rules at the flag's own level: the review rules for `review_required`, the needs-context rules for `needs_context`. `first_flagged_seq` is the first turn the claim was flagged at any level (C1 is `needs_context` from T5, so 5, then red at T11).
- Only expert claims go into `call_claims` and `claimsSoFar`. Other claims are kept in `claims_json` only.
- A reader that throws (a bug, not a model failure) is recorded as `read_status "error"` with the message in `error`, and the call goes on. Otherwise the client would re-send the same turn and every later turn would be refused as out of order.
- A re-sent seq whose words differ from the stored turn is refused with 409 `TURN_CONFLICT`. A re-send with the same words returns the stored decision, even after the call has ended. A new turn on a call that is no longer live is refused with 409 `CALL_NOT_LIVE`.
- `startCall` also pins the case to the policy version when the case has none, which the after-call read would otherwise do. Live and after-call reads then use the same version even if another is activated during the call.
- A correction (`is_correction_of`) is stored as its own `call_claims` row. The claim it corrects keeps its row and flag. Task 13 decides what a corrected live flag means for compliance.

## Task 13: ending a call and keeping what it flagged

- A corrected claim keeps its own flag: each flagged `call_claims` row is one hidden passage group, so `hidden_count` counts a claim and its correction separately when both are flagged.
- Ruling (review, fix round 1), coverage by state: a `policy` finding covers a turn only in REVIEW_REQUIRED, NEEDS_CONTEXT, ESCALATED, REOPENED or DISPOSITIONED. A NOT_TRIGGERED_PENDING_ACK finding does not cover. The spec's fail-closed rule (section 5) wins over the plan's "a policy finding's claim quotes".
- Ruling (review, fix round 1), coverage by turn: coverage is decided turn by turn, not flag by flag. A flag opens a `live` finding when any of its turns is uncovered. The finding's `finding_passages` (whole turn text), `TURN:` reason codes and explanation cover only the uncovered turns. A covering policy finding may be on a different claim, as long as it quotes that turn. Each new live finding gets a review task. The explanation names turns and rules only, never the turn text, and says whether the after-call read finished.
- A flagged claim with a turn that cannot be found in the transcript, or that quotes no turn at all, raises a `LIVE_FLAG_UNMAPPED` warning naming the call claim, once per claim. Any turns that can be found still get a finding.
- If `reconcileLiveFlags` throws after a failed after-call read, a blocking `LIVE_RECONCILE_FAILED` issue is recorded on the case. The error is then rethrown, so the job runner still logs it.
- `reconcileLiveFlags` runs in the same transaction as `persistAnalysis`, and after `recordAnalysisFailure` in its own transaction when the after-call read fails for good. Findings are deduplicated by `live:<caseId>:<callClaimId>`, so a re-run opens nothing twice.
- A call with no expert turn is marked `abandoned`. Nothing is uploaded, and its outages do not become case warnings, because there is no transcript for them to describe. Its `CALL_ENDED` audit event has `status: "abandoned"`.
- Call turn `T<seq>` maps to transcript turn `T<n>`, where n is the turn's place among the turns with text. Today these are the same, since an empty turn is refused when it is posted.
- `ingestTurn` checks the call is still live again inside its write transaction. A turn whose read was in flight when the call ended is refused with 409 `CALL_NOT_LIVE`, so it is never stored after the transcript was cut. `turnsSettled(callId)` resolves once every posted turn has settled, and the end route (Task 14) can await it before calling `endCall`.
- `ackTurn` keeps the first acknowledgement. `recordOutage` refuses a call that is no longer live, and refuses times that do not parse or an end before the start. An outage still open at the end lasts until `ended_at`.
- `findingsCore.ts` needed no change: `origin` already comes from the schema enum, which Task 9 extended with `live`.

## Task 16: audio, Flux and the call session

- Browser auth to Flux, checked against the live service on 2026-11-10 (one grant token, two handshakes, no audio sent): `new WebSocket(url, ["bearer", <grant token>])` opens and Flux answers `Connected`; `["token", <grant token>]` is refused with 401. Deepgram documents `token, <key>` for API keys and the Bearer scheme for grant tokens.
- Deviations from the plan's signatures, all additive so the brief's calls still typecheck:
  - `runCall`'s `source` may also be a factory `(callId) => TurnSource`, because `liveTurnSource(callId)` needs the call id and the call is created inside `runCall`. `runCall` also returns `callId`.
  - `openFlux` takes a fifth, optional `{ mint, onLevel }`: `mint` gives each reconnect a fresh token (a 30 s token cannot be reused), and `onLevel` feeds the hearing watch from the same audio pipeline. `onMessage` gets a third argument, the wall time of the socket's first audio, so Flux's per-socket audio clock can be put on the call clock after a reconnect; `onState` and `onStage` take an optional cause, which becomes the outage's `cause`.
  - A `TurnSource`'s speech times count from the moment `start()` was called; the session uses that moment as the origin for `speechEndedAt`. Task 17's scripted source must follow the same rule.
  - Turn requests: a 401 stops the call and shows broken, as the brief says; so does any other refusal no retry can fix (other 4xx). Network failures, timeouts, 408, 429 and 5xx are retried with the same seq.
- Controller ruling from Task 8's review, applied in `reduceClient`: a red warning always runs its 6 s, even over a broken stage, and broken shows again afterwards if a stage is still down. Applied consistently, it also means a red already showing is no longer cut short when a stage passes 3 s down; the existing test that expected that now uses amber, and a new test covers the red case.
- A Flux `EndOfTurn` without its audio window is reported as a momentary `transcribing` outage (down, then up at once) with the cause "speech-to-text ended a turn without its audio times; that turn was lost", so it reaches the outage record instead of vanishing.
- Review fix round 1:
  - A channel whose audio pipeline cannot be built opens no Flux socket. Its failure sits under `hearing` (its own part, `<channel>-audio`), which no socket event can clear.
  - Flux backoff resets only after a socket stays open 5 s or sends its first `TurnInfo`. Flux's `Connected` greeting does not count.
  - Every retry of the same turn, outage or acknowledgement reuses one `Idempotency-Key`. The server stores only successes, so a retry after an error runs again, and a retry after a lost success is replayed.
  - A 2xx turn reply with an unusable shape is not retried: nothing is shown for that turn, and a momentary `reading` outage records why.
  - A refusal that stops the call also records an open `reading` outage, unless the server would refuse that too (401, 403, 404 or `CALL_NOT_LIVE`).

## Task 17: the control page and the scripted call

- **Every turn with a claim takes longer than the 2.5 s live limit.** In the first `pnpm record:live` run, 11 of 22 reads timed out: every expert turn that carries a claim (about 500 output tokens) and some empty ones. The 11 that finished took 1.1 to 2.5 s with about 80 output tokens and no claims. A deployed Blink on Haiku 5.5 would therefore record those turns as not read live and never turn the pill red during the call; the after-call read would still hide them. This is the Task 2 `haiku-slow` verdict seen on the real form, and it is the owner's to weigh (it is in "Waiting on the owner" already).
- **Deviation: recording waits for the whole answer.** `readTurn` uses `RECORD_TIMEOUT_MS` (30 s) instead of `READ_TIMEOUT_MS` (2.5 s) when `BLINK_LLM_MODE=record`. The limit is not part of the request hash, so replay serves the same answers, and live and replay keep 2.5 s. Without this no recording run could finish, because the turns that matter are exactly the slow ones.
- `LIVE_SYSTEM` was not changed: the pill was red at T11 on the first full recording (round 1 of 3).
- **Replay ignores the live time limit.** 9 of the 22 committed `live_read` recordings took longer than 2.5 s when recorded: T5 3.0 s, T6 8.1 s, T7 4.8 s, T9 4.4 s, T11 5.3 s, T13 4.2 s, T15 3.7 s, T19 2.6 s, T21 2.7 s. Live, those turns would have been recorded as not read, including the red at T11. Ruling (review, fix round 1): replay keeps serving these reads, because the scripted call tests the rules and the pill, not the speed. `pnpm live:check` prints the slow reads on every run, and the tests that assert red at T11 say so in a comment.
- What the scripted call shows, replayed, in both `pnpm live:check` and the browser test: red at T11 (C8: R1, R2, R4), T13 (C10: R4) and T15 (C12: R3). C13 at T17 is needs-context on R1. 4 passages hidden. Compared with the gold after-call findings (T5+T11, T15, T17 needs-context), T13 is an extra flag: the gold compares T13 to a public figure (exact match). It is worth looking at when the thresholds are tuned on the development calls.
- The after-call read of the live transcript is now recorded (`extract-83017799ad425e1e.json`). Two tests in `live-end.test.ts` relied on it failing in replay, so they now point `BLINK_RECORDINGS_DIR` at an empty folder.
- Additions beyond the brief's signatures:
  - `scriptTurnSource(turns, paceMs)` also returns `done`, a promise that resolves after the last turn. The control page ends a scripted call there, since the browser test never presses Stop.
  - `runCall` takes an optional `onStage(stage, up)`, which drives the control page's stage dots. Without it the reading stage cannot be seen from outside the session.
  - `callableCases(db, actor)` and `scriptedCallsAllowed()` live in `src/server/services/live.ts`. The flag is not in `src/server/env.ts`, because importing that file into the app makes Turbopack trace the whole project.
  - `GET /api/dev/script-turns` checks the flag before the session, so without it everyone gets 404, even with no cookie. With it, a banker gets `{ turns: [{ speaker, text }] }`, a reviewer gets 403, and a request with no cookie gets 401.
- `?pace=` is clamped to 50 to 10,000 ms (default 1,500). The control page shows a one-line note when a call is scripted.

## Task 18: the Mac app

- Built on the assumption `audio grant: needs-video` (the spike has no verdict yet): the display-media handler grants the first screen source as `video` beside `audio: "loopback"`. When Task 3 settles on `audio-only`, drop the `video` field in `desktop/src/main.ts`.
- `desktop/` is a pnpm workspace package (`packages: [desktop]` in `pnpm-workspace.yaml`), so the root lockfile covers it and `pnpm install` at the root installs everything. Electron 45.x no longer has an install script (the binary is downloaded by `@electron/packager` while packaging), so nothing needed adding to `onlyBuiltDependencies`.
- The control window can set the pill's visibility over IPC only from its own window and only from the Blink origin. Permissions: `media` for `BLINK_URL`'s origin only; every other permission is refused.

## Task 20: first real call

Step 1 is done: `pnpm live:prepare` (`scripts/prepare-live-call.sh`) resets `data/blink.db` to the Halvorsen case at intake with the manual policy active, and prints the next commands. It starts nothing. Steps 2 to 4 wait on the owner.

**For the owner (Step 2), about fifteen minutes plus the call.**

1. In the repo folder run `pnpm live:prepare`. This deletes and rebuilds `data/blink.db`, the disposable dev database. Run `pnpm db:reset` afterwards to get the usual seeded dev database back.
2. Start the server in live mode and leave it running: `BLINK_LLM_MODE=live BLINK_AUTH_MODE=switcher pnpm dev`. The keys in `.env.local` are used; nothing is printed.
3. Build the Mac app if `desktop/out` is missing (`pnpm desktop:build`), then open it with `open desktop/out/Blink-darwin-arm64/Blink.app`. Do not run the inner binary from a terminal. Allow Microphone and System Audio Recording if macOS asks (see "Spike: Mac app" for what to do if it does not).
4. In the control window choose the **Halvorsen** case.
5. Press **Start**. The pill appears at the top of the screen.
6. Put on headphones, so the expert's voice reaches the app only through the system audio and not through the microphone. Join a Zoom call with a second person (or a second device) who reads the expert's side of a script you wrote. Keep it to about five minutes.
7. During the call, say at least one thing the demo policy restricts. For example, have the expert give a company figure and say it comes from an internal system they can still access.
8. Press **Stop**.
9. Tell the agent the call is done. It reads the record back (Steps 3 and 4).

## Task 22: the release snapshot and the summary leak check

- What counts as hidden is wider than the brief's wording, to fail closed. A passage stays hidden until its finding is cleared: DISPOSITIONED with `cleared_for_research` or `no_concern` on a decision that is not stale (`findingCleared` in `src/core/workflow/brief.ts`). That applies to a `live` finding's passages and to the quotes of any claim with a finding that is not cleared (`hiddenBy`). Rejected claims are included: a claim retired by a corrected transcript can no longer be cited, but what it quoted stays hidden (fix round 1). The same predicate decides whether a claim quoting a live finding's turn is eligible.
- A hidden passage's `numbers` are `numbersIn(text)` (exported from `src/core/release/leak.ts`): digits as the leak check reads them, plus whole numbers 2 to 100 spelled out. The words "zero" and "one" are left out because they are usually not figures ("the big one"); the digits 0 and 1 still count.
- A hidden passage's `names` are the restricted claim's `subject_entity.name` and `scope_detail`, plus `namePhrases(text)`: runs of two or more consecutive capitalised words ("Cardinal Utilities"). A one-letter word ("I") breaks a run and punctuation after a word ends it. A run that opens a sentence is kept both whole and without its first word. A single capitalised word on its own is not a name, so a lone company name in the hidden text is caught only when it is in the claim's fields.
- `visible` collects numbers and names from every eligible claim: its quotes, every string and number in its fields, and its `subject_entity.name` and `scope_detail`. "Halvorsen" is visible (C8), so the summary may say it.
- The leak check reads the brief's section headings as well as its sentences, since both are released.
- A passage recorded on an earlier transcript version is followed onto the current one through the stored `turn_lineage` chain, one version at a time, as the staleness pass does (`src/server/services/placement.ts`). It is never placed by label alone. `diffTurns` from that version to the current one is used only where no lineage is stored. If the text is unchanged, the offsets stand. If it changed (fix round 2, controller ruling, fail closed), three things are blanked:
  - the mapped turn, whole;
  - every turn in the contiguous runs that lineage reports as added directly before and directly after it, whole (a split turn, whichever half is shorter; fix round 3). These runs are found by position in the version, so removed turns never break them, in both the stored-lineage path and the `diffTurns` fallback;
  - every run, in any current turn, that reads the hidden words verbatim once whitespace is collapsed.
  The leak check also compares the summary with the words as they were originally hidden. A passage whose turn row is gone, or whose turn was removed, cannot be placed: the release is refused with `HIDDEN_PASSAGE_UNPLACED` and a message that names only the passage label. Live findings and claims are matched by these mapped current labels for eligibility too. A live passage that cannot be placed adds no label: its old label might name an unrelated current turn. A claim quote that cannot be placed keeps its own label, which can only restrict more.
- Found in fix round 1, and not changed here: a decision on the finding of a retired (rejected) claim goes stale in the release check's staleness pass ("claim removed (C1 · T5, T11)"). So a case with a restricted claim that a correction retired cannot be released at present. This is existing staleness behaviour in `staleness.ts`.
- The demo's template briefs (v1 and v2) pass the leak check; `pnpm demo:check` releases both.

## Task 24: the banker reads the released transcript and summary

- Who may read a release: compliance (`reviewer`, `senior_reviewer`) reads all; every other role, including `policy_owner`, is treated like a banker. A banker reads releases of cases they created (`cases.createdBy`) and any release to `investment_team`. Anything else is a 404, the same as an unknown id.
- Frozen citations (controller ruling, fix round 1): the banker's citation quotes are not read from live claims. `releaseBrief` stores each cited claim's key, summary and quotes in `releases.citations_json` (migration `0003_release_citations.sql`), and the banker is served only that. As a fail-closed backstop, any stored quote that is not wholly inside one visible run of that release's own snapshot turn is dropped (`quoteIsVisible` in `src/core/release/redact.ts`). A release with no stored citations shows none; one with no stored snapshot says the transcript is not available.
- Standing is computed over the releases the reader can open. A banker is never told a release was superseded by one they cannot open; an older brief that `releaseBrief` marked "superseded by brief vN" shows as current to a reader who cannot see vN.
- Files changed outside the brief's list: `tests/e2e/demo.spec.ts` (demo step 7 opens the transcript), `tests/helpers/ui-scope.ts` (scope), `tests/services/release.test.ts` and `tests/services/workflow.test.ts` (callers of `releasedBriefs`), `src/server/services/release.ts`, `src/server/db/schema.ts`, `drizzle/0003_release_citations.sql` and its meta, `src/core/release/redact.ts` (`quoteIsVisible`), and the plan file (ticks).

## Task 26: sign-in replaces the role switcher

- Re-seeding never replaces an existing password hash: `BLINK_SEED_PASSWORDS` only fills a user whose `password_hash` is null, so changing a password there has no effect on a database that already has one. A key that is not a demo user id fails the seed, and the message counts such keys without quoting any.
- `authMode()` (`src/server/auth/mode.ts`) reads only the environment, so the proxy imports it. `pnpm start` with nothing set, and any `next start` without `BLINK_ALLOW_SWITCHER=1`, is password mode.
- The proxy passes each page's path and query to the render in the `x-blink-path` request header; `pageActor()` uses it for `/login?next=`. `next` is followed only when it is a path on this site (`safeNextPath` in `src/lib/session.ts`), never `//host`, a backslash, or `/login` itself.
- Public in password mode: `/login` and `/desktop/pill` (the pill shows only what the control window sends it). Every other page needs a session.
- The sign-in route also requires `Content-Type: application/json` (415 otherwise), so a cross-site HTML form cannot sign a visitor into another account. It purges attempts older than fifteen minutes and expired sessions on every sign-in, and signing in again ends the browser's earlier session.
- In password mode the role gate offers nobody to switch to; it says which roles may open the page. `RoleGate` is now a server component, and the switch buttons moved to `src/components/app/switch-user-buttons.tsx`.
- Files outside the brief's list: `src/lib/session.ts` (`PATH_HEADER`, `LOGIN_PATH`, `safeNextPath`), `src/server/services/seed.ts` (unknown-key check), `src/components/app/switch-user-buttons.tsx`, and the plan and notes files.

## Task 28: break-in tests over every route

`tests/services/breakin.test.ts` differs from the brief in three places, each on purpose:

- **The cleared margin statement is not hidden text.** `hiddenTexts()` leaves out the live turn of a flagged call claim when compliance has cleared every finding on that claim's key. Only C8 (T17, "margins were under pressure well before I left", F3) is affected. The live call flags it `needs_context`, compliance clears F3 (`no_concern`), and the release then shows T17 in full by design: a banker reads a call once compliance has released it. Counting it as hidden would fail the test on correct behaviour.
- **An extra flag only the live call raises.** The gold reader is wrapped so that T1 (the opening remark) also carries a dashboard claim, L1, that the after-call read does not raise. Ending the call turns it into a live finding whose passage is all of T1, and compliance keeps it hidden (`restricted_exclude`). Without it, `finding_passages` is empty: every gold live flag is covered by the after-call read. T1 is used because no after-call claim quotes it, so only the live finding hides it. Removing the live-finding loop in `restrictedOnCase` makes the hidden-text tests fail on `/api/analyst/releases/:id`. T3 would hide "Halvorsen Pumps", which the template summary repeats, so the release would be blocked as a leak.
- **Sign-out answers 200 with no session.** `POST /api/session/logout` is 200 whether or not anyone is signed in (Task 26), so its table row gives `noSession: 200`. The brief's list of exceptions does not name it.
- Task 42 must add the health-check route to the table with `noSession: 200`, or the first test fails.

## Task 29: one call's record and the all-calls overview, as data

- **An outage of hearing or transcribing reads "Blink could not hear the call".** The brief's regex wants `Blink could not hear the call for 19 seconds. … Speech in this gap is not in the transcript.` for the test's outage, which is a transcribing outage. The mockup words a transcription drop the same way. That is accurate: `flux-client.ts` drops audio frames while the speech-to-text socket is down and never re-sends them. `observability.ts` has its own wording table for this. The case warning `endCall` writes (`GAP_WORDING` in `live.ts`, Task 13) still says "could not transcribe … may be missing", and Task 29 leaves it alone.
- **Reviewed wording.** For one passage: "<name> kept it hidden." (`restricted_exclude`), "<name> sent it to legal." (`restricted_escalate_to_legal`), "<name> unhid it." (`cleared_for_research`, `no_concern`). For two it says "both" ("Jordan Ellis sent both to legal."), and for more, "all N". The passages are the turns in the Hidden step: every call turn that the flagged claims on this turn quote. The decision used is the newest one on any policy finding whose claim quotes the turn, or any live finding with a passage on it, compared on the current transcript. A stale decision reads "<name>'s decision no longer stands … Waiting for a new review." with `decidedBy: null`. No decision reads "Waiting for compliance.". A call still live reads "Compliance sees it when the call ends.".
- **Moment times.** `atMs` is when the speaker began, counted from `calls.started_at`: `speech_ended_at` minus the turn's audio-clock length, so T5 sits at 01:10 as in the mockup. Hidden and "linking back to" name turns by that clock time. An outage's `atMs` is its start, and its `totalMs` is how long it lasted.
- **Cost.** A call's cost covers its live reads plus the after-call read of its transcript (`analysis_runs.llm_call_id`). It is null, and the model call counts in `callsWithoutPrice`, when the model has no price, and also when a turn names a model call that has no `llm_calls` row (the gold test reader's `"gold"`). "tokens in" is input plus cache-read plus cache-write tokens. The overview's `typicalCostUsd` is the median cost per call, and it is null if any call's cost is unknown, so it is never quietly lower than the truth.
- **Overview scope.** Counts, speed and problems cover every call, with no date window. Only stage health is limited, to outages that overlap the last hour. Task 30 decides how to label it ("this week" in the mockup).
- Files outside the brief's list: `src/server/services/live.ts` (`spokenTurns` exported, so the record maps call turns onto transcript turns exactly as `reconcileLiveFlags` does).
- **Fix round 1.**
  - **Failed reads.** A failed read is no longer free. Model calls whose `ref_json.callId` is the call's id are priced too: a refusal, truncation or schema failure is logged and paid for, but its turn carries no `llm_call_id`. Such a row is tied to the failed turn whose read window holds it. That window runs from `decided_at` less `rules_ms` and `read_ms` up to `decided_at` less `rules_ms`, with 50 ms slack. A failed turn with no row (a timeout) counts as a model call without a price. A read that never produced an answer has `decidedBy: null`.
  - **Step offsets.** These are anchored on `decided_at`: the rules end there and the read ends where the rules begin. A turn's wait in the call's queue, from `received_at` to the start of its read, shows on the Read step as "Waiting: N s …" when it is over 50 ms.
  - **Policy owner.** For the policy owner, `problems` carry `callId: null` and `title: ""`.
  - **Reviewed wording.** When the findings covering a turn's hidden passages stand at different outcomes, Reviewed states each one with its label, for example "F1: Jordan Ellis sent both to legal. F99: Marcus Lee unhid it.". Passages no finding covers are named too.
  - **Abandoned calls.** They are left out of `typicalCostUsd`.

## Task 30: the three observability screens

- **No date window.** Per the controller's ruling, the overview covers every call. Its figures are labelled "Calls", "Slowest" (not "Calls this week" or "Slowest this week"), and the page says "The figures cover every call so far". The stage row is labelled "over the last hour", which is what the data covers.
- **Headline and caption units (fix round 1, controller ruling).** The headline and both caption figures share one formatter, with the unit chosen once from the slowest: whole milliseconds when the slowest is under 1 s ("5 ms", "within 8 ms", "Slowest: 8 ms"), otherwise seconds to one decimal for all three. The brief's headline regex is relaxed to `/^(\d+(\.\d)? s|\d+ ms|—)$/`, and the test checks that the headline and the caption use the same unit.
- **The opened moment sits inline.** Clicking a turn opens its steps under the row, inside the list, and only one at a time. An outage has no steps, so it does not open. The rules step's detail is shown one rule per line.
- **Who sees what.** `/calls`: reviewers, senior reviewers and the policy owner. A banker gets the role gate. The policy owner sees no call names and no links, and a note says why. `/calls/[id]`: reviewers and senior reviewers only. The banker and the policy owner both get the role gate, because the record shows what was said.
- **calls.spec.ts.** It runs after `call.spec.ts` (Playwright orders files by name: `call.` sorts before `calls.`). A `beforeAll` also plays the scripted call itself when no call exists, so the file can run alone. Two tests go beyond the brief's three: neither a banker nor the policy owner can open one call, and the case header's "Call record" link opens the record.
- **Fix round 1.** Times on the overview use `formatDateTime` ("Nov 10, 19:32:44 UTC"). An open moment's toggle has `aria-controls` pointing at its steps region. A new browser test has the banker open a fresh case ("Outage drill"), start a call, record a 4 s transcribing outage, and end the call. It then checks that the reviewer sees the problem with its case name and an "Open call" link, and that the policy owner sees the problem with no case name, no "Open call" link, and no link to any call.

## Task 32: the review workspace

- **Files changed outside the brief's list.** None. `src/app/cases/[id]/page.tsx` needed no change (it has no colour classes). Its rule-test scope entry is the single file, not the folder, so the audit, brief and baseline pages under it stay for their own tasks.
- **Panes are no longer sized by their content.** The grid was `40fr 25fr 35fr`, but with `fr` tracks a long unwrapped finding title widened the middle pane to about 640 px and squeezed the other two. It is now `minmax(0,36fr) minmax(0,30fr) minmax(0,34fr)`, so the findings list is a steady third and titles truncate (the full title, severity, rules and who raised it are in the row's tooltip).
- **Wording changes (visible text only).** The findings filter lists states in words ("Review required") instead of the raw state name. The rule trace shows "and / or / not" in lower case instead of "AND / OR / NOT". The severity reads "high severity" in lower case. The finding row's severity, rules and "escalation" or "reviewer" marks moved to its tooltip so the line holds label, state, title and turns.
- **Tones.** The workspace no longer uses any tone alias: status is a `StatusDot`/`StateLabel`, and tags ("AI-compiled", "senior decision", "edited in v2", "raised by a reviewer") are plain muted words. The aliases stay in `status-chip.tsx` because `src/app/metrics/page.tsx`, `src/app/policies/page.tsx`, `src/components/documents/document-card.tsx`, `src/components/brief/brief-workspace.tsx` and `src/components/policy/policy-detail.tsx` still use `amber`, `red`, `emerald`, `slate`, `indigo` and `sky`.
- **Screenshots.** `.superpowers/sdd/2026-11-10-live-guidance/shots/32/`: F1 selected, scrolled, F3 and its actions, the claims list with the attest dialog, and a live finding (F6 after the scripted call), each in light and dark at 1440 by 900. They were taken with throwaway specs that were deleted afterwards.
