# A full live run on the deployed app (Task 44)

On 2026-11-10 (Pacific time; 2026-11-11 00:29 to 00:50 UTC), one Halvorsen call went end to end through the deployment at https://blink-production.up.railway.app. The policy owner compiled and approved the demo policy. The banker opened a case and held a spoken call. Compliance decided every finding, attested, and approved and released the summary. The banker then read the released transcript and summary. Every step ran live: Anthropic models, Deepgram Flux, and Railway's disk. Nothing came from recordings.

The policy, case and compliance steps went through the pages, with real clicks and form entries, in a headless Chromium driven by the repo's Playwright. The scripts sit in the git-ignored `data/deployed-run/`. They find elements by role and visible text, and they sign in through `/login` with the four demo users' passwords from `.env.local`. No password or session cookie was printed or written to a file. The call itself ran with `pnpm eval:spoken`. Screenshots of each key moment are in `data/deployed-run/shots/`, which is not committed.

No Railway setting was changed, and nothing was redeployed. The container did not restart during the run: every health check answered 200, and no step returned a 502.

## What the seed had left

- **Before the run:** the deployment had no policy version at all, so nothing was Active. It had `case_halvorsen` (at intake, from the seed) and one case titled "Live call" (at intake, made by someone else, most likely the friend). Neither was touched. `/api/calls` showed no calls, and `/api/metrics` showed $0.056 of model cost: the 6 document-facts jobs from the first start.

## Step 1: compile and approve the demo policy

- **As:** Dana Okafor, the policy owner.
- **Path:** `/policies/new`. She picked the "Demo policy v1" preset and clicked "Create draft and compile".
- **Compile time:** from the click to "Validated" took **185 s** on the page. The compile log shows:
  - Pass A finished at 00:30:20.
  - Pass B #1 and Assembly #1 ended `CLAUSE_DROPPED` at 00:31:18.
  - The compiler retried by itself. Pass B #2 and Assembly #2 finished at 00:32:04 with no blocking issues.
  - AI scenarios finished at 00:32:56.
- **Validation:** 0 blocking issues. 1,156 evidence combinations were checked across 4 monitors.
- **Approval:** Dana typed the first 6 characters of the bundle hash (`09fa0e…`) on the Approve tab. Version `pv_01M7405V4J0AC1687XVTCSWSWH` became **Active** at 00:33:02 and is AI-compiled, not the manual fallback.
- **Cost:** 6 `claude-opus-5-5` calls, $0.567.
- **Effect on other cases:** approval re-evaluates cases. The two cases at intake had no transcript and did not change.

## Step 2: a case and a spoken call

**The case.** As Priya Raman (the banker), on `/cases/new`, the Halvorsen packet (`fixtures/cases/halvorsen/packet.json` and `expert.json`) was typed into the form. That made `case_01M740QN874Q1T7DH8HZ1QQEHG`, "Halvorsen Pumps — deployed spoken run (2)". `case_halvorsen` was left clean for the friend.

**The call.** Command:

```
pnpm eval:spoken --transcript fixtures/cases/halvorsen/transcript-v1.txt --case case_01M740QN874Q1T7DH8HZ1QQEHG --server https://blink-production.up.railway.app --as user_priya --expect-red T11 --name deployed-halvorsen-2
```

`--expect-red T11` names the source remark, because Halvorsen has no `labels.json`; it changes only the report. There was no `--db`, since the server's database is on Railway. So the after-call comparison was read from the pages, not from the script.

**This was the second attempt.** In the first case, the run's own form script typed into the wrong fields. A loose label match ("Title" also matches "Case title"; "Employer" also matches "Current employer") gave the case the title "Regional Sales Director, West". It also made the expert's current employer the issuer and dropped his Halvorsen employment row. That call (`call_01M740FQM03CXPGSF6W1YY4VXM`) ran and its after-call read finished. The packet was wrong, though, so the case was left in review and not carried further.

- **The leftover case:** `case_01M740EV6DA1XZ7FC7B5SMWXXN` is still on the deployment.
- **Its timings:** they are given below for comparison, and they count in `/calls`.
- **The fix:** the script now matches labels exactly and checks the fields before it submits. This was a mistake in the run's script, not in the app.

**What the call showed (attempt 2):**

- **Turns:** 22 written turns (11 banker, 10 expert, 1 moderator). 2.6 min of audio per channel. Flux heard 22 turns.
- **Live reads:** 6 turns were not read live, all expert turns and all timeouts at the 2.5 s limit: T7, T9, T11, T13, T15, T17.
- **The pill:** it stayed on `Listening` the whole call. No amber and no red.
- **The end:** the call ended with `Call ended. Nothing was hidden.`
- **No red on the source remark (T11).** Its live read timed out. This is the known `haiku-slow` issue already waiting on the owner (Task 2 Step 5, Task 38), and it is recorded as it happened. `pnpm eval:spoken` exits 1 because the expected red was missed. Attempt 1 behaved the same way: T5, T7, T11 and T15 timed out, and there was no red.
- **The after-call read** (`claude-opus-5-5` extraction, then the policy) found 4 findings on the case:

| Finding | Kind | State | Turns | Subject |
|---|---|---|---|---|
| F1 | policy, rule R2 | review required (senior compliance officer) | T5, T11 | access to the former employer's systems after leaving |
| F2 | policy, rule R2 | needs context | T15 | the Cardinal Utilities contract |
| F3 | AI-suggested | review required | T15 | issuer talk after the banker's caution |
| F4 | AI-suggested | review required | T5, T11 | the issuer's name transcribed inconsistently |

## Step 3: compliance finishes the case

All of this went through the case page and the brief page.

1. **F2, as Marcus Lee (reviewer).** Marcus recorded a clarification: "a former Halvorsen colleague told him about the rebid in October, after he had left in July". He mapped the answer's fields:
   - source: insider conversation;
   - access timing: after employment;
   - company: the covered issuer;
   - period: current.

   The monitors re-ran. R2 and R3 then held, and F2 went to review required, escalated to a senior compliance officer.
2. **F3 and F4, as Marcus.** F3: "Keep hidden". F4: "Unhide: no concern".
3. **F1 and F2, as Jordan Ellis (senior compliance officer).** Both: "Keep hidden and send to legal". Every finding was then decided.
4. **Attestation, as Marcus.** "Attest", then "I reviewed the whole call". The case went to Ready for approval.
5. **The summary, as Marcus.**
   - "Draft with AI" was ready in about 12 s ($0.026). The page listed 9 eligible claims and 2 withheld (C1, C8).
   - He approved the hash for the covering analyst.
   - **Release was refused:** "the summary repeats a quote from hidden passage F2 · T15". See "What failed" below.
   - He edited the brief and removed the one sentence citing C7. That saved v2 with a new hash.
   - He approved v2 and released it. The release succeeded ("Every release condition held"), and the case is Released.

## Step 4: both ends

**The banker's view (Priya, `/analyst`):**

- The released summary appears with its claim citations and "2 statements withheld by compliance."
- "Read the transcript" opens the released transcript: "6 passages hidden by compliance." It shows 6 blank bars labelled "Hidden by compliance": T5, T11 (three sentences) and T15 (two sentences).
- The page's text and its HTML (transcript and summary pages) contain none of "Cardinal", "Salesforce", "dashboard", "login", "rebid", "never shut it off" or "keep it quiet".

**Compliance's view (Marcus, `/calls`):**

- The overview lists both calls, each with 22 turns and 0 warnings.
- The headline: "1.8 s typical time from words to warning; 19 in 20 within 2.8 s; slowest 2.8 s; measured on 44 turns". Below it: "Turns with a problem 10 of 44", each live stage working, and "Typical cost per call unknown, a call has a step with no price".
- Recent problems lists each timed-out turn with a link to its call.
- The call's record, `/calls/call_01M740R9XT5HN7KPZ1TVTC3AM1`, shows every turn in order with its time and read status. It shows "Not read live (timeout). Covered by the after-call read." for the six timeouts, and "Cost unknown, 6 steps have no price".

## Timings

Measured from both ends, as Task 38 defined them. "Flux" means from `speech_ended_at`, the end of Flux's audio window. "Audio" means from the true end of the synthetic audio. Figures are typical (median) · 19 in 20 (95th percentile) · worst, in seconds.

| Run | Heard | Not read live | Flux end to shown | Audio end to shown | Within 1.0 s (Flux) | Within 2.0 s (Flux) |
|---|---|---|---|---|---|---|
| Deployed, attempt 2 (carried through) | 22 | 6 | 1.75 · 2.81 · 2.84 | 2.70 · 3.89 · 4.34 | 1 of 22 | 11 of 22 |
| Deployed, attempt 1 (wrong packet) | 22 | 4 | 1.60 · 2.70 · 2.73 | 2.45 · 3.69 · 3.75 | 1 of 22 | 12 of 22 |
| Deployed, both calls (as `/calls` shows them) | 44 | 10 | 1.8 · 2.8 · 2.8 | | | |
| Task 38, Halvorsen, local `next dev` (manual policy) | 22 | 6 | 1.83 · 2.57 · 2.57 | 2.63 · 3.63 · 3.96 | 0 of 22 | 13 of 22 |

- **The speed target is still missed, as on the local run.** The target is within 1.0 s for a typical turn and within 2.0 s for 19 turns in 20. The typical time is a little better on the deployment. The tail is about 0.25 s worse: a timed-out turn shows at about 2.8 s instead of 2.57 s, because each turn now crosses the internet from this Mac to Railway's `iad` region and back.
- **Flux's end-of-turn wait was close to the local one.** The median from the end of the audio to `speech_ended_at` was 0.78 s on the deployment (attempt 2), against 0.72 s on Task 38's local Halvorsen run. Both are nearest-rank medians (rank 11 of 22), as the app's `percentile` computes them; the midpoint medians are 0.79 s and 0.74 s. Both come from the per-turn results in `data/spoken/results/`. Task 38's 0.79 s covers all six local calls (n = 77), so it is not the like-for-like figure.
- **Banker turns are not the slow part.** Every banker turn was read. The slow ones are expert turns that carry a claim, whose reads run into the 2.5 s limit.
- **Other stage times:**
  - The live compile took 185 s.
  - The after-call extraction took about 75 s per call.
  - The summary draft took about 12 s.

## What failed, or did not go as expected

1. **No live red on the source remark (T11), in either attempt.** The read timed out at the 2.5 s limit. It is the known `haiku-slow` issue, waiting on the owner. The after-call read and compliance did hide T11, so the passage never reached the banker. No code was changed.
2. **The first AI summary could not be released, and this points to a potential leak path.** The release check found that the draft repeated five or more words of hidden passage F2 at T15. The sentence was "Competitor Brightwater has been aggressive on price and in the utilities market.", which cited C7.
   - **Why it happened:** the expert said the Brightwater remark and the unannounced Cardinal contract in one sentence. The after-call finding F2 hid that whole sentence. C7 quotes only the Brightwater part, and no finding is on C7, so C7 stayed eligible and the drafting step used it.
   - **The cause in code:** `claimEligibility` in `src/core/workflow/brief.ts` restricts a claim by shared turn only for live findings. For an after-call finding it restricts only the finding's own claim. So a claim whose quote lies inside a span an uncleared finding hides can still be cited.
   - **Why it is a leak path, not just friction.** The release check stopped it this time only because the drafted sentence copied five or more words of the hidden passage. The review verified two routes past it:
     - `findLeaks` (`src/core/release/leak.ts`) catches only shared runs of five or more words, figures, and multi-word names. A paraphrased sentence citing C7 would pass, and so would a single-word name such as "Brightwater". The allowlist of visible figures and names is built from eligible claims, so C7's own figures and names would be exempt.
     - The banker's citation chip shows the cited claim's `summary`. `citationsFor` (`src/server/services/briefs.ts`) includes it, release freezes it (`src/server/services/release.ts`, `citationsJson`), and `src/components/brief/released-brief.tsx` renders it. `findLeaks` never sees those summaries, so C7's chip could show hidden words even when the summary sentence itself is clean.
     - The chip's quotes are not a route. `frozenCitations` keeps a quote only if `quoteIsVisible` finds it in a visible part of the blanked transcript, so C7's quote, which lies inside the hidden T15 span, never reaches the banker. Only the claim's summary goes unchecked.
   - **A fix follows in a separate commit:** a claim becomes ineligible while any of its quotes overlaps a span that an uncleared finding hides, and release also leak-checks the cited claims' summaries.
   - **Fixed** in the commit `fix(brief): never give the summary a claim whose words are hidden`. See "Fix A" in the notes file.
   - **To reproduce:**
     1. Run a Halvorsen call where T15 is not flagged live.
     2. Let the after-call read raise the Cardinal finding.
     3. Keep it hidden.
     4. Draft with AI, approve, release.
   - **Ownership:** this is the original author's code. Pranay has no commits in these files. Not fixed in this commit; the fix is the separate commit named above.
3. **Flux misspelled the issuer, and the policy then missed it until a person corrected it.** Flux wrote Halvorsen as "Halvason", "Talveshams", "Halthorsen" and "Halverson". The case's aliases are "Halvorsen", "HLVP" and "Halvorsen Pumps".
   - **F2:** its claim named the company "Halvason", which did not match the covered issuer. So only R2 asked for context, and R3 (an unannounced event at the covered issuer) stayed silent. R3 fired only after Marcus mapped the company to the covered issuer in the clarification.
   - **F1:** its claim named "Talveshams" but was still marked as the issuer.
   - **F4:** the AI-suggested finding pointed out the inconsistent name.
   - On a real call, a misheard issuer name can keep an issuer-specific rule from firing until a reviewer corrects the field. Nothing was changed. This is for the owner to weigh alongside Task 38's Earnings-21 finding that Flux misses issuers' own names.
4. **The first attempt's packet was wrong** because of the run's own form script. Its case stays on the deployment in review, as "Regional Sales Director, West". See Step 2.
5. **Small things, not app faults:**
   - The step 1 script's wait for the words "Active. Approved" timed out after the approval click; the cause was not traced. The approval had gone through: the API showed `ACTIVE` with an approval time of 00:33:02, and the screenshot was taken on a fresh load.
   - The call's record says "Passages hidden 0" while the case hid 6 passages. That page counts only what was hidden live, so it is correct, but a reader may expect the after-call count.
   - On the banker's transcript, T1 (the moderator's notice) is labelled with the expert's name, because the moderator spoke on the expert's channel.

## Spend

**Anthropic.** Read from the deployment's `/api/metrics` as Marcus, before and after.

| Stage | Calls | Cost |
|---|---|---|
| policy compile (pass A 1, pass B 2, assembly 2, scenarios 1; `claude-opus-5-5`) | 6 | $0.567 |
| after-call extraction (`claude-opus-5-5`, one per call, both attempts) | 2 | $0.425 |
| live reads that finished (`claude-haiku-5-5`, both attempts) | 34 | $0.009 |
| live reads that timed out | 10 | unknown (no usage is returned; about $0.003 at the finished reads' rate) |
| summary draft (`claude-opus-5-5`) | 1 | $0.026 |
| **total** | | **$1.027** (from $0.056 to $1.084) |

**Deepgram Flux.** Two calls, each 2.6 min on two channels: 10.6 min streamed, about $0.08 at $0.0077 a minute. The console has the exact figure.

**Plan total:** about $14.67 of the $25 cap.
