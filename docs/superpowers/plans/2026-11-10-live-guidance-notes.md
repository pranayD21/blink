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

## Spend log

| Date | Task | What ran | Dollars |
|---|---|---|---|
| 2026-11-10 | 2 | Anthropic: 30 `claude-haiku-5-5` calls, about 1.0k uncached input, 71k cache-read, 2.5k cache-write, 7.4k output tokens (cache write priced at an assumed 1.25 times input) | $0.005 |
| 2026-11-10 | 2 | Deepgram Flux: about 47 real-time streams of 7 to 8 s each, roughly 6 minutes of audio (estimate at the pay-as-you-go streaming rate; the console shows the exact figure) | about $0.05 |

## Waiting on the owner

- Task 2 Step 5: the verdict is `haiku-slow`, so the owner decides whether to take Groq out of the backlog (spec section 6). Until they answer, the plan continues with Haiku 5.5.
