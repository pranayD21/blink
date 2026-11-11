# Demo script: a live call (finals, 2026-11-19)

Five minutes, on the deployed app, around one real call between two people. The banker runs the call from the Mac app with the pill at the top of the screen. A second person reads the expert's lines in Zoom. Everything is live: Deepgram Flux, `claude-haiku-5-5` during the call, `claude-opus-5-5` after it, and the database on Railway. Nothing is replayed.

- **Address:** https://blink-production.up.railway.app
- **People:** Dana Okafor (policy owner), Priya Raman (banker), Jordan Ellis (senior compliance officer). Each signs in with their email at `blink.demo` (`dana@`, `priya@`, `jordan@`) and the password in the owner's `.env.local` (`BLINK_SEED_PASSWORDS`). Jordan is used for every compliance step, because a senior compliance officer can decide every finding, attest and release; a reviewer cannot decide an escalated finding.
- **Data:** the Halvorsen case is synthetic. The lines below come from `fixtures/cases/halvorsen/transcript-v1.txt`.

## Before the demo

1. **Check the deployment:** `pnpm smoke --url https://blink-production.up.railway.app` passes.
2. **Check the policy:** signed in as Dana, Policy shows the demo policy as Active. (It was compiled and approved on the deployment in Task 44.)
3. **Make a fresh case:** signed in as Priya, open `/cases/new` and fill it in from `fixtures/cases/halvorsen/packet.json` and `expert.json`. A call can only start on a case that has no transcript yet, so each rehearsal needs its own case.
4. **Build and open the Mac app:** `pnpm desktop:build`, then `open -n desktop/out/Blink-darwin-arm64/Blink.app --args --server=https://blink-production.up.railway.app`. Open the app this way, never by running the binary inside it. Sign in as Priya in its control window. Allow Microphone and System Audio Recording when macOS asks. Allow Screen Recording too if it asks: the app grants a screen source alongside the system audio (`audio grant: needs-video`). "Spike: Mac app" in the notes file says what to do if macOS does not ask. Every rebuild makes macOS ask again, so build once, before the rehearsals.
5. **Sign in on the browser side:** use one browser profile for Dana, one for Jordan and one for Priya, because each profile holds one session.
6. **Set up the call:** start a Zoom call between the banker's Mac and the expert reader's own device.
   - The banker wears headphones, so the expert's voice reaches Blink only through the system audio and never through the microphone.
   - The expert reader sits where the banker's microphone cannot pick them up.
   - The rehearsals decide how the room hears the expert.
7. **Have a phone hotspot ready and tested,** and have the recorded video open in a player (Task 46).

Nobody has yet tested the Mac app on a real call: the Task 3 spike and the Task 20 call are still waiting on the owner. The first rehearsal is that test.

## The call: the lines

The banker's lines are said into the microphone, and the expert's lines come from Zoom. Leave a short pause after each line. Expect to see the following.

| # | Who | Line | Expected pill |
|---|---|---|---|
| B1 | Banker | Thanks for making time. Could you start with a quick overview of your background? | Listening |
| E1 | Expert | Sure. I spent about seven years at Halvorsen Pumps, most recently as regional sales director for the West. I left in July. | Listening |
| B2 | Banker | Big picture, how does demand look for industrial pumps heading into year-end? | Listening |
| E2 | Expert | Honestly, orders fell off a cliff. They're down about twenty percent. | Listening: a figure with no source is ambiguous, so it shows nothing |
| B3 | Banker | Are Halvorsen's own orders down that much this quarter? | Amber: the question asks for the issuer's current-quarter figure, which a rule restricts |
| E3 | Expert | That's Halvorsen's West region, this quarter. | Red likely (P5) |
| B4 | Banker | How do you know? | Listening |
| E4 | Expert | I still have a login to their pipeline dashboard in Salesforce. They never shut it off when I left. When I checked last week, Q3 bookings were tracking down twenty percent versus last year. | Red (P2, P3), or Listening |
| B5 | Banker | I want to be careful here. Please don't share anything confidential. | Listening |
| E5 | Expert | Of course, sorry. Let's move on. I'll just say Halvorsen's margins were under pressure well before I left. | Listening |
| B6 | Banker | Thanks, that's all my questions. | Listening |

Why each pill:

- **B3, amber.** The question names the issuer, an operating figure and the current quarter. Those are the topic of P2 (an operating result from an internal source) and P5 (a recent employee on current-period results). Nothing yet rules either out, so the question probe shows amber.
- **E3, red likely.** After E3 the claim has every part of P5. The expert left Halvorsen in July, within twelve months. The figure is the issuer's orders for the current, unreported quarter. The public comparison does not support it: the filed Q2 figure is company-wide and high single digits. So P5's rule meets review. Red always takes precedence over amber.
- **E4, red or Listening.** The login remark meets P2 (an internal source) and P3 (access to a former employer's systems after leaving). Before it, neither rule could be decided. Their rules meet review on this turn, so the pill goes red again, because a red is never held back. If the read times out, it stays on Listening.

These are what the rules give when every read finishes in time. They were checked by reading the policy and its rules, not by running these lines.

- **The amber on a question** is covered by the service tests (`tests/services/live.test.ts`): a scripted reader returns a question about the issuer's current bookings, and the pill goes amber, then stays quiet for 30 seconds. Amber has not yet appeared on a spoken call.
- **The red** appears in the replayed scripted call (`pnpm live:check`). On spoken calls it has come only from expert turns whose read finished within the limit.

Amber shows at most once in 30 seconds.

**If the red does not appear, carry on.** The live reader often misses its 2.5 s limit on an expert turn that carries a claim. In every spoken Halvorsen run so far, the read of the source remark (E3 and E4 together, there T11) timed out (`haiku-slow`, waiting on the owner). A turn that is not read live is read after the call, and the after-call read hides it. So say the line for step 3 as written, and at step 5 show the passage hidden. The pill then ends with "Call ended. Nothing was hidden.", because that count covers only what was flagged live. Do not repeat the line to get a red.

## The steps

Times are a guide; the rehearsals set them.

### 1. The approved policy (0:00 to 0:30)

- **Who:** Dana, in the browser.
- **On screen:** Policy, then the Active demo policy. On its tabs: the monitors drawn as a graph, and validation with every combination of evidence checked across 4 monitors. It reads Active and approved by hash.
- **Say:** "The firm's policy, in plain English, compiled into rules that code checks, and approved by one person by its exact hash. Only this version is used."

### 2. The banker starts the call (0:30 to 0:45)

- **Who:** Priya, in the Mac app.
- **On screen:** the control window lists the fresh Halvorsen case. Press Start. The pill appears at the top centre of the screen, above Zoom: `Listening`. The stage names under the case (Hearing, Transcribing, Reading, Rules, Screen) show each part of the live path working.
- **Say:** "The banker picks the case and presses Start. That's all they do. Blink listens to both sides of the call."

### 3. The expert drifts, then crosses the line (0:45 to 1:45)

- **Who:** Priya and the expert reader, B1 to E4 above.
- **On screen:** the pill stays on `Listening` until B3. It shows `Getting close to inside information. Steer away.` on B3, then `Sounds like inside information. Move on.` on E3, and possibly again on E4. Each warning stays six seconds.
- **Say (after the amber):** "Amber: the banker's own question is heading toward something the policy restricts. No suggested questions, no transcript, just one line."
- **Say (after the red, or where it should have been):** "Red: a recent Halvorsen employee just gave this quarter's number, which public filings don't support. Move on. And if Blink runs out of time on a turn, it reads it again properly after the call."

### 4. The call ends with a count (1:45 to 2:00)

- **Who:** Priya, B5 to B6, then Stop in the control window.
- **On screen:** the pill reads `Call ended. N passages hidden and sent to compliance.`, with `1 passage` for one, or `Call ended. Nothing was hidden.` when nothing was flagged live.
- **Say:** "The moment the call ends, every flagged passage is hidden. The banker can read nothing from this call until compliance releases it."

### 5. Compliance sees what is hidden, and why (2:00 to 2:45)

- **Who:** Jordan, in the browser: Cases, then the Halvorsen case.
- **On screen:**
  - **The after-call read:** it takes about 75 s on the deployment, and the case page shows its progress. If it is still running, do step 8 now and come back.
  - **The findings:** the review workspace lists them. The finding on the source remark should link E2 to E4, as F1 linked T5 and T11 in the Task 44 run.
  - **For each finding:** whether it is hidden from the banker until compliance decides, the linked passages with their exact quotes, and "Why (trace)", each rule's guard as code evaluated it.
- **Say:** "Compliance sees the hidden words in full, the rule each one met, and the evidence. A model filled in the form; code made the call."

### 6. Keep one hidden, unhide one, release (2:45 to 3:45)

- **Who:** Jordan.
- **On screen:**
  - **Keep one hidden:** the finding on the source remark. Choose Dispose, then "Keep hidden and send to legal", and give a reason.
  - **Unhide one:** the margins remark (E5), if it was flagged. It is waiting for context, so choose "Promote to review" with a reason, then Dispose with "Unhide: no concern". If it was not flagged, unhide an AI-suggested concern instead. Pick a finding whose turn no kept finding also covers, or the banker will see no difference. Decide any other findings too; every finding needs a decision before attesting.
  - **Attest:** choose Attest, then "I reviewed the whole call".
  - **The brief:** choose "Draft with AI" (about 12 s), then "Approve this hash…", then "Approve this hash" again in the dialog, then "Release to the analyst".
  - **If release is blocked:** the page lists the reasons. Edit out the sentence it names, approve again and release.
- **Say:** "Every decision is recorded with who, when and why. Before release, code checks the summary against every hidden passage."

Keep the reasons ready to paste. "Promote to review" needs a reason, and a disposition needs at least 20 characters of rationale.

### 7. The banker reads the release (3:45 to 4:15)

- **Who:** Priya, in the browser: Released briefs.
- **On screen:**
  - **The summary:** it has its citations and a line counting the statements compliance withheld.
  - **The transcript:** "Read the transcript" opens it. The kept passages are blank bars labelled "Hidden by compliance". The margins remark, if it was unhidden, reads in full.
- **Say:** "The banker gets the whole call back, minus exactly what compliance kept hidden. The hidden words never leave the server."

### 8. The call's record and one moment (4:15 to 5:00)

- **Who:** Jordan, in the browser: "Call record" in the case header, or Calls, then the call.
- **On screen:**
  - **Counts at the top:** turns heard, warnings shown, passages hidden, problems and cost. "Passages hidden" counts only what was hidden live.
  - **The moments:** one line per moment, in order.
  - **One moment, opened:** click the moment for E4. With a red, it opens into Transcribed, Read, Rules checked, Shown, Hidden and Reviewed, each with its time, its model or code, and what went in and out.
  - **If E4 timed out:** its line reads "Not read live (timeout). Covered by the after-call read."
- **Say:** "Everything Blink heard, read, decided and showed, with how long each step took and what it cost. Nothing fails quietly."

## Fallbacks, in order

1. **A phone hotspot,** if the venue's network is slow or down. Move the Mac to the hotspot and go on. The Zoom call and the deployed app both need the internet.
2. **The recorded video,** if the hotspot fails too, or the Mac app or the deployment does. Play the screen capture of a clean run (Task 46, Step 2) and narrate the same lines over it. Say that it is a recording.
