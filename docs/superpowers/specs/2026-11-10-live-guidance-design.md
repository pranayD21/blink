# Blink: live call guidance, automatic hiding, and observability

Design document. Written 2026-11-10. Status: **awaiting owner approval**. Nothing described here is built yet.

Read with [BLINK_BUILD_SPEC.md](../../../BLINK_BUILD_SPEC.md) (what exists and why) and [HANDOFF.md](../../../HANDOFF.md) (state of `main` at `5426d4e`). Where this document and the spec disagree, this document wins; [section 13](#13-changes-to-the-spec) lists the differences. Reference mockups: [2026-11-10-live-guidance-mockups.html](2026-11-10-live-guidance-mockups.html).

Throughout, **(owner)** marks something the owner said or chose, and **(my call)** marks a choice made by the agent that wrote this document, which the owner may overrule.

## 1. Why

What exists today reviews a transcript after the call is over. A compliance reviewer gets a list of flags about a minute after upload and decides each one. The owner's picture of the product is different: Blink sits with the banker **during** the call and warns them before the conversation goes somewhere it should not, then hides the problem passages by itself and hands them to compliance.

The finals are on 2026-11-19, live and in person, judged by Ramp engineers.

The owner's words, kept verbatim because they carry the intent:

- "The main thing is that the banker should experience no cognitive overload and be able to fully talk to the expert."
- "Regardless, it should reduce cognitive overload and there shouldn't be any stress."
- "I don't want to suggest what they should ask about. I should just say, 'Sounds like inside information. Move on.'"
- "The transcript should automatically be reviewed for all censorship and everything. Things might get flagged and sent for review so that some other people, perhaps a compliance team, can review it."
- "Prioritize observability and a very, very nice minimalist UI."
- "For observability everything should be very, very, very clear about what's happening."
- On test data: "I'd prefer that over an AI model because the AI model might fabricate stuff that literally would never exist in a real conversation."
- Carried over from the handoff: "Completion looks like an actual run with real tools. Everything is real, nothing is local." and "The development of the entire product is overfit to what you already know and have seen in the test."

## 2. Who uses it

| Person | When | What they need |
|---|---|---|
| Banker (the `analyst` role in the code) | During the call | To keep talking to the expert. One glance tells them whether to move on. |
| Compliance reviewer | After the call | The hidden passages, in full, with the reason each was hidden, and a decision to record. |
| Engineer, judge, policy owner | Any time | To see exactly what Blink heard, concluded and did, how long it took and what it cost. |

## 3. Goals, non-goals, anti-goals

**Goals**

1. **Live warning.** During a call in any call app, a small pill at the top of the banker's screen changes when the conversation drifts toward, or reaches, inside information.
2. **Automatic hiding.** When the call ends, flagged passages are hidden at once, without waiting for a person.
3. **Compliance review with context.** Compliance sees the hidden text, why it was hidden, and decides.
4. **Observability.** Every step Blink takes on a call is recorded and shown plainly.
5. **A quiet, minimal interface** across the whole app.
6. **Real services.** The app runs deployed, with live speech-to-text and live model calls.
7. **An honest test** on real material nobody on this project wrote.

**Non-goals**

- Suggesting what the banker should ask (owner).
- Training a custom classifier model ([section 6](#6-how-the-live-path-works) explains why).
- Moving the database to Postgres, Supabase or Turso.
- Real sign-in or SSO. A Windows version of the banker's app. Languages other than English.
- Recording-consent handling, trade surveillance, or any statement that a call "is compliant". The spec's limits on what Blink may claim still hold.
- Signing or distributing the Mac app. It runs from source on the presenter's Mac.

**Anti-goals: failure even if everything works**

- The banker has to read, click or think about Blink during the call.
- A warning or a hidden passage that the record cannot explain.
- Anything that fails without saying so.
- A test score from cases written by an AI, or by whoever tuned the prompts.
- A recording presented as a live run.

## 4. What the banker sees

One pill, at the top centre of the screen, above whatever call app is open (owner chose this over a corner card and an edge glow). It can say five things and nothing else:

| State | Exact text | When |
|---|---|---|
| Quiet | Listening | Most of the call |
| Amber | Getting close to inside information. Steer away. | The conversation is drifting (wording is my call) |
| Red | Sounds like inside information. Move on. | The expert has said it (owner's wording) |
| Ended | Call ended. *N* passages hidden and sent to compliance. | The call is over (owner) |
| Broken | Blink can't hear the call. | Blink is not working (my call) |

Rules for the pill:

- No suggested questions, no transcript, no buttons, no sound (owner for the first; the rest are my call).
- One message at a time. A warning stays about six seconds, then the pill returns to "Listening" (my call).
- **Red** shows when what has been said so far meets a policy rule that requires review. In the code, that is a monitor entering `REVIEW_REQUIRED`.
- **Amber** shows when the banker's own question asks for something a rule restricts, or when a statement is one missing fact short of meeting a rule and the conversation stays on that subject. A statement that is merely ambiguous, such as "orders are down twenty percent" with no source, shows nothing. Amber appears at most once in thirty seconds; red is never held back. These thresholds are my call and should be tuned on the development test calls.
- **Broken** shows when any stage (hearing, transcribing, reading, rules) has been down for more than three seconds.

Speed target (my call, to be confirmed by measurement on day one): the warning is on screen within 1.0 second of the end of the sentence for a typical turn, and within 2.0 seconds for 19 turns in 20.

## 5. After the call

1. **Hide first.** The moment the call ends, every passage tied to a live flag is hidden. "Hidden" means the server returns a blank bar in place of the text to everyone except the compliance roles (`reviewer`, `senior_reviewer`). It is enforced by the server, not by styling.
2. **Then read properly.** The existing after-call pipeline runs on the full transcript: the stronger model extracts claims with exact quotes, code checks every quote, code applies the policy. Its result is authoritative. It can add hidden passages the live path missed.
3. **Fail closed.** A passage flagged live that the after-call read does not confirm stays hidden, marked "flagged live only", until compliance decides (my call).
4. **Compliance decides each passage:** keep hidden, unhide, or send to legal. These map onto the existing finding dispositions. Each decision is an event in the existing hash-chained audit log, with who, when and why.
5. The research brief continues to draw only on what was not restricted, as today.

**Which outcomes hide a passage (my call).** The pipeline raises a concern in three ways, and they are treated differently:

| Outcome | In the code | Hidden? |
|---|---|---|
| A policy rule is met | A monitor in `REVIEW_REQUIRED` | Yes |
| A rule could not be decided by the end of the call, for example a company number whose source was never stated | A monitor still in `NEEDS_CONTEXT` | Yes, shown to compliance as "could not rule out" |
| An AI-suggested concern outside the policy | An AI-suggested finding | No. It goes to compliance, but nothing is hidden without a rule to trace it to |

The count on the "Call ended" pill, and the pass bars in [section 11](#11-honest-testing), count the first two rows.

**What the banker can read after the call (awaiting the owner's answer).** Today a banker can read no transcript text at all: `loadWorkspace` in `src/server/services/workspace.ts` is for reviewers only, `analystCaseView` in `src/server/services/cases.ts` returns no turn text, and a banker sees only a released brief. The owner said "by default, everything is hidden", which can be read two ways. This document proposes the following, and it is unconfirmed:

- While the after-call read is running, about a minute, the banker sees nothing. Otherwise anything the live path missed, timed out on, or lost in an outage would be readable.
- Once it finishes, the banker sees the transcript with the hidden passages blanked out. This is a new page and a new server response that does the blanking.
- If the owner instead means the whole transcript stays hidden until compliance acts, that is already how the app behaves, and the banker's transcript page is not built.

## 6. How the live path works

```text
Mac app                                    Blink server                    Mac app
┌──────────────────────────────┐   turn   ┌─────────────────────────────┐  state  ┌──────┐
│ microphone   → channel 1     │ ───────▶ │ fast reader fills a form    │ ──────▶ │ pill │
│ system audio → channel 2     │          │ existing rules run in code  │         └──────┘
│ live speech-to-text          │          │ everything is recorded      │
└──────────────────────────────┘          └─────────────────────────────┘
```

- **Hearing.** The banker's microphone is one channel and the computer's audio (everyone else on the call) is the other. The channel tells Blink who is speaking, so no speaker-guessing is needed.
- **Transcribing.** A streaming speech-to-text service turns each channel into text and signals when a speaker has finished a turn.
- **Reading.** For each finished turn, a small fast model fills in a fixed form about that turn. The form is the typed claim the after-call reader already produces (`ClaimFields` in `src/core/types.ts`): who or what it is about, what kind of figure or event, which period, how the speaker knows, whether they still have access, any confidentiality phrases, and which earlier turn it connects to. Almost every field is multiple choice.
- **Deciding.** The existing pure code (`evaluateClaim`, the predicate registry, the monitor reducer in `src/core/`) applies the approved policy to the form. No model decides a policy outcome, live or after the call.
- **Showing.** The server returns the pill state.

**On using a small model as a classifier (owner asked).** This is that, in the form that keeps Blink explainable. The model classifies each turn into fixed categories; code turns the categories into "nothing", "steer away" or "move on". A model trained to output "move on" directly was considered and rejected for now, for three reasons: there is no real labeled data to train it on ([section 11](#11-honest-testing)); it would bake in one firm's policy, and policies differ per firm; and it could not say why it fired, which breaks the observability goal. Once real calls accumulate, the recorded decisions are training data for exactly such a model, used as a first-pass filter. That is future work.

**Model choice.** Measured on day one, not assumed. Candidates: `claude-haiku-5-5` with thinking off, low effort and the fixed part of the prompt cached; and one open model on a fast host (Cerebras `gpt-oss-120b`). Pick by measured 95th-percentile time and by agreement with the after-call reader on the development test calls. If nothing is measured, use Haiku 5.5, since the key already exists. The after-call reader stays on `claude-opus-5-5`.

**When something goes wrong.** A turn the reader cannot finish in 2.5 seconds is recorded as "not read live" and is covered by the after-call read. A model refusal is treated the same way. A dropped transcription connection reconnects; the gap is recorded with its start, end and cause, the pill shows "Blink can't hear the call" while it lasts, and the missed audio is not silently skipped in the record.

**Record and replay.** The live path is always live; audio cannot be replayed from a request hash. Its tests feed recorded audio files through the same code. The after-call path keeps its record and replay modes.

## 7. The banker's Mac app

A small desktop app (Electron) that does two things: shows the pill, and captures the two audio channels (my call). It is the only way to get a frameless pill that floats at the top of the screen above another app, and the only way to hear any call app with one click and no screen-share dialog. Everything else stays a website.

- The pill window is transparent, frameless, always on top, and lets clicks pass through.
- Starting: the banker picks the case and presses Start. Stopping ends the call.
- Needs macOS 14.2 or later and two permissions: microphone and system audio recording.
- **Fallback** if the Mac app cannot capture audio reliably by the end of day one: a floating Chrome window (Document Picture-in-Picture). It works above other apps but keeps a thin title bar, cannot place itself, and hears a call reliably only when the call runs in a Chrome tab.

## 8. Observability

Four rules, taken from Google's reliability handbook, OpenTelemetry, Honeycomb, Langfuse, Datadog and Open Policy Agent's decision logs:

1. **Nothing fails quietly.** Every failure is recorded and, where it affects the banker, shown.
2. **Every hidden passage traces back** to the exact words, the rule, the policy version, and the person who reviewed it.
3. **Every model step records which model and which prompt version**, with tokens and cost, so a result can be reproduced. An unknown cost is shown as unknown, never as zero.
4. **Speed is shown as typical, 19-in-20 and worst case, never as an average.**

**What is recorded.** One record per call. One wide record per turn, carrying: call and turn ids; when the speech ended on the audio clock; when the text arrived; when reading started and finished; how long the rules took; when the pill changed; the text as received; the form the reader filled; the model, prompt version, tokens and cost; every rule evaluation with its result and the policy version (the existing `monitor_evaluations` rows already hold this); what the pill showed; any error, by stage. One record per outage. Later, the reviewer's decision on each hidden passage.

**What is shown.** Three screens, mocked up in the reference file:

- **One call.** Counts at the top (turns heard, warnings shown, passages hidden, problems, cost), the health of each stage, then one line per moment in order. Quiet moments stay quiet; warnings and problems stand out.
- **One moment, opened.** Each step in order (transcribed, read, rules checked, shown, hidden, reviewed) with what went in, what came out, whether a model or code decided, and a bar showing how long it took.
- **All calls.** One headline number, the typical time from words to warning, with the 19-in-20 and worst figures beside it. Then stage status, calls, turns with a problem, how many hidden passages compliance later unhid (the false-alarm rate), cost per call, and recent problems, each linking to its call.

No outside observability service is used; the data lives in Blink's own database (my call).

## 9. The look

Quiet and monochrome. One plain line per event. Status is a small coloured dot beside words, never a capital-letter badge. One accent at most. Numbers in one weight. The references the owner asked to be researched: Linear (one line per event), Vercel (monochrome, thin lines), Granola (a quiet window beside a call), Braintrust and Langfuse (each step with its time and cost).

This applies to every existing screen: case queue, review workspace, brief, audit, policy, documents, metrics. The review workspace keeps its three panes and its content; it loses its badges.

## 10. Services

Named here for approval. **Nothing is provisioned until the owner says yes.** Keys are collected through the secure secret prompt, never in chat or in git.

| Need | Service | Notes |
|---|---|---|
| Live speech-to-text | Deepgram, Flux model | Built for detecting the end of a turn; about a quarter of a second by its own figure. $200 free credit. Compare once against Soniox on day one. Groq was checked: its speech-to-text takes uploaded files only, not a live stream. |
| Models | Anthropic API | Existing key. Haiku 5.5 live, Opus 5.5 after the call. |
| Fast model host | Cerebras | Only if it wins the day-one measurement. Has a free tier. |
| Hosting | Railway | One service running the web app and the worker together, with one persistent disk. |
| Database | SQLite on that disk | Owner: "if SQLite is already on Railway, I guess it works." Supabase would mean rewriting every database call for no visible change. |

The deployed site sits in front of paid APIs, so it gets one shared passcode (my call). The role switcher stays as it is.

## 11. Honest testing

The owner wants real material found online, not AI-written cases. A search on 2026-11-10 found **no ready-made benchmark**: no public dataset of expert calls, or of any conversations, labeled for inside information. What does exist:

| Source | What it is | Who says what the right answer is | Use |
|---|---|---|---|
| UK FSA final notice, Einhorn | A full recorded investor call: about 9,000 words, 198 turns | The regulator names the passages that were inside information | Should flag |
| *US v. Gupta*, 2nd Circuit 2014 | About 50 turns of wiretapped calls | The court | Should flag |
| US Justice Department complaints, Galleon cases | Dated, attributed wiretap quotes; scanned, needs OCR | The sworn FBI affidavit | Should flag |
| FSA final notice, Kyprios; DOJ release, Chu | About 15 short quotes | The regulator, the DOJ | Should flag |
| FINRA v. Dotson, 2015 | A recorded analyst call | Two authorities: not inside information in law, yet escalation was required by the firm's policy | The borderline case |
| In Practise interviews | 20 free, full expert interviews that passed a compliance review | The publisher's compliance team | Should stay quiet. **Needs their written permission.** |
| Earnings-21 and Earnings-22 | 39 and 119 hours of real call audio with transcripts, CC BY-SA 4.0 | Reference transcripts | The spoken path: accuracy on names and numbers, turn detection, speed |
| EDGAR codes of ethics | Real firms' written policies | n/a | Whether the policy compiler works beyond the demo policy |
| FinDVer | 2,400 claims checked against filings, MIT licence | Expert annotators | The "is this already public" comparison |

Real flagged material comes to a handful of calls and roughly 100 to 150 labeled statements. It is a small test, and it will be reported as one.

Rules:

1. Remove the fixture-derived examples from the prompts, then freeze prompts and rules before any test call is opened. Re-record afterwards, as the handoff describes.
2. Test material is never used as an example in a prompt.
3. Split it. Development set, which may be inspected and fixed against: Gupta, the Justice Department complaints, Kyprios, Chu. Sealed set, run once at the end: the Einhorn call and Dotson.
4. Report counts per call, not one percentage.
5. Each real call also runs through the live path as audio. Where only text exists, it is read aloud by a synthetic voice; the words stay real.
6. The nine existing fixtures stay as regression tests. They are no longer reported as a score.
7. The known silent miss is fixed: `company_specific_operating_metric` ignores any metric outside a fixed list, so customer churn read off an internal dashboard produces no finding.

**Which policy the real calls run under (my call).** Blink applies one firm's written policy; the regulators' labels are legal findings. The two do not always agree, and the demo policy is too narrow to be a fair test: it has four rules, written around the demo case. So:

- Before any test call is opened, pick three real published policies from EDGAR and compile each with Blink's own compiler. The demo policy is run alongside them for comparison only.
- Every real call runs under each policy. A miss is reported as one of two different things: the policy did not cover the situation, or the policy covered it and Blink missed it. Only the second counts against the pass bar.
- Each call needs a case packet (the company, who is speaking, their role and history). It is filled in only from facts stated in the authority's own document.
- **Dotson's right answer is "flagged for compliance".** Blink applies policy, not law, and that firm's policy required escalation.

**Who prepares and runs the sealed set (my call).** Preparing a call means reading it, so the session that tunes the prompts must never do it. A separate, isolated session, with no access to the prompts or this repository's working tree, turns the Einhorn notice and Dotson into turns, labels, packets and audio, and keeps them outside the repository. At the end it runs them once against the frozen build and reports counts only. The owner may spot-check its labels.

Pass bars (my call, carried from the handoff's proposal): at least 90% of the passages an authority identified are hidden; no call the authority faulted comes back with nothing flagged; at most one hidden passage per stay-quiet call; the same result on four of five repeat runs.

Without In Practise's permission there is no fair real "should stay quiet" set, and the false-alarm bar cannot be measured. Earnings calls do not fill that gap: company officers speaking on a public call are not what an expert-call policy is written for.

## 12. Order of work, and what gets cut

**Day one is a spike** on the owner's Mac, and its code may be thrown away. It answers three questions: can the Mac app hear both sides of a call in Zoom; does the pill float above Zoom; how long from the end of a sentence to a decision, with each candidate model. The owner's hands are needed for a few minutes, to grant permissions and speak into a call.

Then, in order:

1. The live path end to end, recording every step from the first turn.
2. Hiding at call end, and the compliance decision.
3. The three observability screens.
4. The redesign of the existing screens.
5. The real-material tests, and fixing what they show.
6. Deploy to Railway; a full live run on the deployed app.
7. Rehearse, and record the backup video, by 2026-11-18.

If time runs short, cut from the bottom of this list (my call): the all-calls overview, then the redesign of the policy and documents pages, then the size of the sealed test. The live pill, the hiding, and the one-call record are the last things to go.

The demo on the 19th is a real call between two people, with Blink running live. It depends on the venue's network, so the recorded video is the backup, and a phone hotspot is the first fallback.

## 13. Changes to the spec

- **Section 1.4:** "Live audio or transcription" is now in scope.
- **"Humans decide":** still true for unhiding and for releasing a brief. Hiding now happens automatically, before any person decides.
- **D19, hosting:** Railway, not the presenter's laptop.
- **D4, model:** a second, smaller model is used on the live path.
- **Section 15, design language:** replaced by [section 9](#9-the-look).
- **Section 19, demo script:** to be rewritten around a live call once the live path works.

## 14. Left to the builder

Table and column names; endpoint shapes; how the Mac app and the server talk (one request per finished turn, answered with the pill state, is the simplest thing that meets the speed target); whether to start reading before the speaker has fully finished; the pill's animation; how the banker picks a case in the Mac app; how the passcode is checked; test layout; the exact attribute names in the per-turn record (follow OpenTelemetry's generative-AI names where they exist).

## 15. Open items for the owner

1. **What the banker can read after the call, and when.** [Section 5](#5-after-the-call) gives the proposal and the alternative. The answer decides whether a banker-facing transcript page is built at all.
2. **Approve the services** in [section 10](#10-services), create the Deepgram and Railway accounts, and say when a few minutes at the Mac are possible for the day-one spike. Nothing can be provisioned, and the spike cannot run, without this.
3. Decide whether to ask In Practise for permission. A request can be drafted for the owner to send.
4. Confirm or change the pass bars in [section 11](#11-honest-testing).
