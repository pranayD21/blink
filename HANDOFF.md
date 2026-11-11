# Handoff

Written 2026-11-10, at the end of the live guidance plan ([plan](docs/superpowers/plans/2026-11-10-live-guidance.md), [design](docs/superpowers/specs/2026-11-10-live-guidance-design.md)). This describes `main` at `49fe660`, plus the commit that adds this file.

Read this first. The [README](README.md) says how to run things, and the [notes file](docs/superpowers/plans/2026-11-10-live-guidance-notes.md) holds every measurement, ruling and deviation. The handoff from before this plan is in git: `git show 5426d4e:HANDOFF.md`.

## Summary

Every task an agent could do in the plan is done. What is left needs the owner: their hands, their decision, or a step that can only follow one of those. The full list is in [Open owner steps](#open-owner-steps).

- **The product is built.** A banker runs a call from the Mac app with a pill at the top of the screen. Blink hides what was flagged as soon as the call ends. Compliance decides each passage, and the banker reads the blanked transcript and a leak-checked summary.
- **It is deployed:** https://blink-production.up.railway.app, with password sign-in.
- **It has been tested on real material.**

Two results matter most:

1. **The live red is often late.** The live reader misses its speed target, so it usually cannot turn the pill red on a long expert turn (`haiku-slow`). The after-call read hides those passages anyway. Whether to try a faster model host is the owner's decision.
2. **The Mac app has never heard a real call.** The day-one spike that checks it hears Zoom, and the first real call, both wait on the owner. The finals demo depends on both.

## The state at the end of this plan

### Built

- **The live path:**
  - the Mac app (`desktop/`), which shows the pill and captures the microphone and system audio as two channels;
  - Deepgram Flux turn detection;
  - a live reader on `claude-haiku-5-5` that fills in the claim form;
  - the existing pure rules, which decide the pill;
  - one wide record per turn.
- **After the call:**
  - flagged passages are hidden at the end;
  - the after-call read on `claude-opus-5-5`;
  - fail-closed live findings;
  - compliance decisions in plain words ("Keep hidden", "Unhide: no concern", "Keep hidden and send to legal");
  - release, which takes a snapshot of the blanked transcript and leak-checks the summary and the cited claims' summaries (Fix A);
  - the banker's released transcript and summary.
- **Security:**
  - password sign-in with sessions;
  - the role switcher only in development and tests;
  - a case check on every request;
  - break-in tests over every route;
  - banker self-sign-up (by Pranay; always a banker).
- **Observability:** one call's record, one moment opened step by step, and the all-calls overview (`/calls`).
- **The look:** every screen restyled to the quiet monochrome look, then given a glass restyle by Pranay. That restyle added a landing page with the blinking mark, a sliding section bar, a guided trial ("Walk me through a trial") and a one-button Call page. Pranay also removed the "Synthetic data" marker.
- **Honest testing:**
  - three real policies;
  - five real development calls;
  - the spoken path with synthetic voices;
  - a freeze tag and a brief for the sealed run;
  - a permission request for a stay-quiet set.
- **Deployment:** a Docker image, a health check, a start script and a smoke test. The app runs on Railway with a persistent volume.

### Verified for this commit

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | pass |
| `pnpm test` | 1,117 tests in 54 files pass |
| `pnpm build` | pass |
| `pnpm e2e` | the demo spec, then the 8 live specs (scripted call, call record, overview, access, pill), pass |
| `pnpm demo:check` | all checks pass; 19 model calls replayed |
| `pnpm live:check` | all checks pass. The pill is red at T11; 9 of 22 recorded reads took longer than the 2.5 s live limit |
| `pnpm desktop:build`, `pnpm desktop:smoke` | pass |
| `pnpm smoke --url https://blink-production.up.railway.app` | passed 10 of 10 in Task 43. On the Fix A deploy it failed only 'GET / redirects to /login', because `/` is now a public landing page; the check is updated in a separate commit, not yet run against the deployment |

Anthropic spend over the plan is about $14.67, against a cap of $25 (spend log in the notes file).

## Where the results are

| What | Where |
|---|---|
| Three published policies compiled by Blink: all compile, none validates (`CLAUSE_DROPPED`) | [docs/eval/2026-11-real-policies.md](docs/eval/2026-11-real-policies.md) |
| The after-call read on five real calls under four policies: 5 of 5 labelled statements hidden; `chu` comes back with nothing flagged; repeat runs 5/5, 5/5, 4/5 | [docs/eval/2026-11-real-dev.md](docs/eval/2026-11-real-dev.md) |
| Six calls through the live path as speech: 0 of 6 labelled turns red live, 6 of 6 hidden after the call; typical 2.11 s, 19 in 20 within 2.81 s; Flux on Earnings-21 | [docs/eval/2026-11-spoken.md](docs/eval/2026-11-spoken.md) |
| One full live run on the deployment, policy to release; no live red on T11; the summary leak path that became Fix A; the misheard issuer name | [docs/eval/2026-11-deployed-run.md](docs/eval/2026-11-deployed-run.md) |
| Fix A: a summary never cites a claim whose words are hidden | the notes file, "Fix A"; commits `0f27034` and `49fe660` |
| The freeze for the sealed run | tag `eval-freeze-1` (`5b495fa`); the notes file, "Task 40: the freeze" |
| The brief for the sealed run, for a separate session | [docs/eval/sealed-brief.md](docs/eval/sealed-brief.md) |
| The request to In Practise for a stay-quiet set, not yet sent | [docs/eval/in-practise-request.md](docs/eval/in-practise-request.md) |
| The finals demo | [docs/demo-script.md](docs/demo-script.md) |

## Honest limits

- **A handful of real test calls.** Five development calls with five labelled statements; two of the calls are private. The sealed set (two more documents) has not been run.
- **No stay-quiet set.** Without In Practise's permission, the false-alarm bar cannot be measured.
- **Synthetic voices in the spoken test:** macOS `say`, digital silence, no room noise.
- **Live reds can be missed.** The live reader misses the 2.0 s target, and an expert turn that carries a claim often times out at 2.5 s and is not read live (`haiku-slow`). The after-call read hides it. So the pill's end count, which covers live flags only, can read "Nothing was hidden." while the case hides several passages.
- **Flux can mishear issuer names** ("Halvason" for Halvorsen). An issuer-specific rule then stays quiet until a reviewer corrects the company.
- **Real policies compile with coverage gaps.** The ten predicates cannot express some required clauses. The real-policy runs load them anyway, for testing only; the app would never activate them.
- **The Mac app was built assuming `audio grant: needs-video`.** The spike that settles it waits on the owner. If it decides `audio-only`, drop the `video` field in `desktop/src/main.ts`.
- **The Chrome fallback (Task 19) is not built.** It is needed only if the spike's verdict is `fallback`.

## Open owner steps

These are the same as "Waiting on the owner" in the notes file, where each has its details.

1. **Task 2 Step 5.** The verdict is `haiku-slow`. Decide whether to take Groq out of the backlog as a faster host for the live reader. Until then, Haiku 5.5 stays. Task 38's speed finding goes with this decision, including whether `speech_ended_at` should be redefined.
2. **Task 3 Steps 2 to 5.** Open the spike app, allow both permissions and play the Zoom speaker test (about ten minutes; instructions in the notes, "Spike: Mac app"). Steps 3 to 5 then record the answers, write `verdict: mac-app` or `fallback` and `audio grant: audio-only` or `needs-video`, and commit.
3. **Task 19.** Build the Chrome picture-in-picture pill only if the spike says `verdict: fallback`.
4. **Task 20 Steps 2 to 4.** Hold a five-minute real call with headphones, in Zoom, with a second person reading the expert's side. `pnpm live:prepare` is ready (instructions in the notes, "Task 20: first real call"). Steps 3 and 4 then read the timings back and commit them.
5. **Task 38.** Spoken input misses the speed target; this is decided together with item 1.
6. **Task 39 Step 3.** Send the In Practise request from the owner's own address, after filling in the recipient from their compliance page and checking their terms.
7. **Task 41.** Start a separate session with `docs/eval/sealed-brief.md` as its whole brief. Then commit its counts-only report, `docs/eval/2026-11-real-sealed.md`. The session that tuned the prompts must not run it or read `~/.blink-sealed/`.
8. **Task 44, the leftover case.** `case_01M740EV6DA1XZ7FC7B5SMWXXN` ("Regional Sales Director, West", a wrong packet) is in review on the deployment. Clean it up or leave it.
9. **Task 44, the misheard issuer name.** Decide what to do about Flux's spellings keeping R3 quiet.
10. **Task 46 Steps 1 and 2.** Rehearse the demo twice from `docs/demo-script.md` on the deployment, with the person who will read the expert's lines. Then record a screen capture of one clean run as the backup, on or before 2026-11-18. Step 3, noting and fixing what the rehearsal showed, waits on these two.

## Picking this up

```bash
pnpm i
pnpm db:reset          # seeded database, eval replayed
pnpm dev               # http://localhost:3000, web and worker, replay mode, role switcher
pnpm typecheck && pnpm lint && pnpm test && pnpm demo:check && pnpm live:check
```

- **Remote:** `https://github.com/pranayD21/blink.git`, branch `main`. The repository is public.
- **A second developer:** Pranay commits UI work to `main`. Do not edit his files. He avoids prompts, predicates, the policy core, recordings, the real fixtures, eval code and scripts, docs, the deployment files, `package.json` and the lockfile.
- **Keys:** `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `RAILWAY_API_TOKEN` and `BLINK_SEED_PASSWORDS` live only in `.env.local`, which git ignores, and in Railway's variables. Never print or commit one.
- **The deployment:**
  - **Where:** Railway project `blink`, service `blink`, region `iad`, volume `blink-volume` at `/data`. The trial ends on 2026-12-10.
  - **What is deployed, at the time of writing:** deploy `c7fedf51`, from main `49fe660` (Fix A), made 2026-11-11 01:18 UTC. Pranay also deploys his own builds from Cursor, so check the Railway dashboard for the current one. The redeploys are listed in the notes, "Task 43: the deployment".
  - **After the finals (2026-11-19):** stop the service to save credit (`railway down`, or the dashboard). The volume keeps the data until it is deleted.
  - **Config:** `railway.json` keeps working until 2026-12-01; `railway config migrate` is left for later.
  - **The CLI** lives under `data/railway-home/`, with `HOME` pointed there.
- **The freeze:** until the sealed run is reported, do not change `src/server/llm/prompts/**`, `src/core/predicates/**`, `src/core/policy/**`, `fixtures/real/policies/*.compiled.json` or `src/server/eval/real.ts`. UI, docs and deployment work can go on.
- **Private material:** the two Kyprios calls are in `~/.blink-real-local/dev/` on the owner's machine, never in git. They are reported by id and counts only. The sealed material goes in `~/.blink-sealed/` and is opened only by the sealed session.
- **Node 26** is the pinned version (`.nvmrc`). Node 24 works too: this commit's checks ran on 24.10.

Two rules that are easy to break:

- **Changing a prompt changes its request hash.** Bump its `*_PROMPT_VERSION` and record again, or the replayed checks fail with a replay miss. `tests/services/recordings.test.ts` catches it.
- **`src/core/` has no I/O, clock or randomness.** Time arrives as an argument. Keep it that way; the validator, the pill and the tests rely on it.
