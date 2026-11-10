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
6. **Real services, all on free plans** (owner: "everything free"). The app runs deployed, with live speech-to-text and live model calls.
7. **An honest test** on real material nobody on this project wrote.
8. **Secure access** (owner). A banker reads a call only after compliance has fully approved it, and can never reach hidden text or anyone else's data.

**Non-goals**

- Suggesting what the banker should ask (owner).
- Training a custom classifier model ([section 6](#6-how-the-live-path-works) explains why).
- Moving the database to Postgres, Supabase or Turso.
- Single sign-on through a company directory. A Windows version of the banker's app. Languages other than English.
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

**What the banker can read after the call (owner).** "After the call the banker should be able to read the full transcript plus a release summary, but only after it's fully approved by the compliance team."

- Until compliance has fully approved the call, the banker can read nothing from it. That is how the app behaves today: `loadWorkspace` in `src/server/services/workspace.ts` is for reviewers only, and `analystCaseView` in `src/server/services/cases.ts` returns no turn text.
- "Fully approved" means every hidden passage has a decision, the whole call is attested, and the summary's exact text is approved. This is the existing release check, extended to cover the transcript.
- On release the banker gets two things together: the summary, and the transcript. Both are new to the banker's side of the app; the transcript page does not exist yet.
- This document reads "the full transcript" as the whole call with the passages compliance kept hidden still blanked out. Passages compliance chose to unhide are shown. This reading is unconfirmed, and it is the cautious one.
- If a corrected transcript arrives after release, the existing staleness rules apply: the released transcript and summary are marked as under re-review until compliance approves again.

### Keeping it secure

The owner: "The transcript and summary should be secured so that they can't hack into other data or see it, and the summary shouldn't have any confidential information leaked into it."

How that is met is my call:

- **Real sign-in on the deployed app.** Each person signs in with their own account, and the role comes from the account. The role switcher is what makes the app insecure today: anyone can become a reviewer. It stays available only in local development and tests.
- **Every request is checked on the server.** A banker can open only their own cases. A request for another case, or for anything meant for compliance, is refused. Nothing relies on an id being hard to guess.
- **Hidden text never leaves the server for a banker.** It is removed before the response is built: not in a page, not in an API response, not in the summary, not in an error message or a log the banker can reach.
- **The summary cannot leak.** As today, the model that drafts it is never given a restricted statement. In addition, before release, code compares the summary with every hidden passage and blocks the release if a quote, a figure or a named detail from one appears in it. Compliance then approves the exact text.
- **Break-in tests.** A set of tests acts as a banker and tries to read another banker's case, a reviewer's view, and hidden text by every route the app exposes. They must all be refused, and they run with the rest of the tests.
- Keys for outside services exist only on the server.

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

**Model choice.** Measured on day one, not assumed. Candidates: `claude-haiku-5-5` with thinking off, low effort and the fixed part of the prompt cached; and, if the owner approves one, an open model on a fast host that has a free plan ([section 10](#10-services)). Pick by measured 95th-percentile time and by agreement with the after-call reader on the development test calls. If nothing is measured, use Haiku 5.5, since the key already exists. The after-call reader stays on `claude-opus-5-5`.

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

The owner approved Deepgram and Railway on 2026-11-10, with one condition: **everything free**. No service is used that needs a card. Keys are never written in chat or committed to git.

| Need | Service | What is free | Notes |
|---|---|---|---|
| Live speech-to-text | Deepgram, Flux model | $200 credit, no card, no expiry. About 430 hours of Flux. | Built for detecting the end of a turn; about a quarter of a second by its own figure. Groq was checked: its speech-to-text takes uploaded files only, not a live stream. |
| Hosting | Railway | A 30-day trial with $5 of credit and no card. 1 GB of memory, a 0.5 GB disk. | One service running the web app and the worker together, with one persistent disk. The trial covers the finals. Afterwards the free plan gives $1 a month, which will not keep the app running. Deploy late and keep memory low: a service holding 1 GB all month would use the $5 in about 15 days. |
| Database | SQLite on that disk | Included | Owner: "if SQLite is already on Railway, I guess it works." Supabase would mean rewriting every database call for no visible change. |
| Models | Anthropic API | **Not free.** | The one paid item, on the owner's existing key. Haiku 5.5 live, Opus 5.5 after the call. A few cents for the live path of a call; under fifty cents for the after-call read. |
| Fast model host | Not chosen | Cerebras gives its credit only with a payment method on file, so it is out. | The day-one comparison uses a host with a free plan and no card, such as Groq, or is skipped. Not approved by the owner yet. |

**Accounts, as of 2026-11-10.** Both were created at the owner's request, under the owner's personal Google account, with no card.

- **Deepgram:** $200.00 of credit showing. An API key named `blink-dev`, expiring 2026-12-10, is in `.env.local` as `DEEPGRAM_API_KEY`.
- **Railway:** on the full trial, 30 days or $5.00. A new account starts on a limited trial with restricted outbound network access, which would have blocked the calls to Deepgram and Anthropic; connecting the owner's GitHub account verified it. A token named `blink-deploy` is in `.env.local` as `RAILWAY_API_TOKEN`. Nothing is deployed, and the trial clock is running: it ends on 2026-12-10.

`.env.local` is ignored by git. Neither value has been printed or committed.

The deployed app is protected by real sign-in, described under [Keeping it secure](#keeping-it-secure).

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
2. Hiding at call end, the compliance decision, and release of the transcript and summary to the banker.
3. Sign-in, the server-side access checks, the summary leak check, and the break-in tests.
4. The three observability screens.
5. The redesign of the existing screens.
6. The real-material tests, and fixing what they show.
7. Deploy to Railway; a full live run on the deployed app.
8. Rehearse, and record the backup video, by 2026-11-18.

If time runs short, cut in this order (my call): the all-calls overview, then the redesign of the policy and documents pages, then the size of the sealed test. The live pill, the hiding, the security work, and the one-call record are the last things to go. The app is not deployed to a public address without step 3.

The demo on the 19th is a real call between two people, with Blink running live. It depends on the venue's network, so the recorded video is the backup, and a phone hotspot is the first fallback.

## 13. Changes to the spec

- **Section 1.4:** "Live audio or transcription" is now in scope.
- **"Humans decide":** still true for unhiding and for releasing a brief. Hiding now happens automatically, before any person decides.
- **D19, hosting:** Railway, not the presenter's laptop.
- **D4, model:** a second, smaller model is used on the live path.
- **D13, sign-in:** the role switcher is replaced by real sign-in on the deployed app. Section 1.4 still excludes single sign-on.
- **The banker's view:** a banker now reads the released transcript as well as the summary.
- **Section 15, design language:** replaced by [section 9](#9-the-look).
- **Section 19, demo script:** to be rewritten around a live call once the live path works.

## 14. Left to the builder

Table and column names; endpoint shapes; how the Mac app and the server talk (one request per finished turn, answered with the pill state, is the simplest thing that meets the speed target); whether to start reading before the speaker has fully finished; the pill's animation; how the banker picks a case in the Mac app and signs in from it; how accounts and passwords are stored; how the leak check matches figures and names; test layout; the exact attribute names in the per-turn record (follow OpenTelemetry's generative-AI names where they exist).

## 15. Open items for the owner

Answered on 2026-11-10: what the banker can read after a call ([section 5](#5-after-the-call)), and the services ([section 10](#10-services)).

Still open:

1. **Approve this document**, so that a build plan can be written from it.
2. Say when a few minutes at the Mac are possible for the day-one spike.
3. Confirm that "the full transcript" means the whole call with the passages compliance kept hidden still blanked out.
4. Decide whether to ask In Practise for permission. A request can be drafted for the owner to send.
5. Confirm or change the pass bars in [section 11](#11-honest-testing).
