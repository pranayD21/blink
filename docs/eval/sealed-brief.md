# Brief for the sealed run

This is for a separate session, one that has not seen the work on prompts, predicates or the development set. Follow it as written. If a step cannot be done as written, stop and report it. Do not work around it.

The build was frozen at the git tag `eval-freeze-1`. Run only that commit, and change nothing in it.

## Rules

- **Never open anything under `src/server/llm/prompts/`,** and do not read any prompt text in any other form. Knowing what a prompt says is exactly what this run must not be influenced by.
- **The material never enters the repository.** That covers the documents, their text, the cases built from them, and any coverage files. Everything lives under `~/.blink-sealed/`.
  - The FCA's site terms forbid placing its documents in any public or private retrieval system without permission, and the repository is public.
  - The only thing written into the repository is `docs/eval/2026-11-real-sealed.md`, and it holds counts only.
- **Run once.** The eval runs a single time. It is not re-run to get a better result, and nothing is tuned between runs. A failure of setup (a crash before any score) may be fixed and re-run, but only in the case files, never in the code, and the report says so.
- **No quotation anywhere.** The report contains no transcript words, no paraphrase of what was said, and no names other than the case ids. Do not paste terminal output from a non-`--counts-only` command into the report or into chat.
- **Never print or commit a secret.** The keys are in `.env.local`, which is git-ignored.

## Steps

1. **Fetch the two documents** into `~/.blink-sealed/sources/`:
   - the FSA final notice on David Einhorn: `https://www.fca.org.uk/publication/final-notices/david-einhorn.pdf`;
   - *FINRA v. Dotson*: `https://www.finra.org/sites/default/files/OHO_Dotson_20090208031-02_080715.pdf`.

   Record each file's URL, date fetched and SHA-256. Extract the text with `pdftotext -layout`, marking the pages.

2. **Build each call as a case** under `~/.blink-sealed/<id>/`, in the layout `fixtures/real/README.md` describes: `source.md`, `source.txt`, `transcript.txt`, `speakers.json`, `packet.json`, `expert.json` and `labels.json`. Use ids such as `einhorn-1` and `dotson-1`, and one folder per call the document quotes in sequence.
   - **Turns:** `transcript.txt` holds only words the document quotes, word for word, in the document's order. The person passing information is the expert, and the person receiving it is the analyst.
   - **Labels:** label a turn only where the authority itself says that statement conveyed inside information, and cite the paragraph or page.
     - For Dotson, the right answer is "flagged for compliance": the call should come back with something flagged. Label only what the decision itself identifies.
     - Record every judgment call in `source.md`.
   - **Checks:** the real-fixtures checks (`tests/core/real-fixtures.test.ts`) can be pointed at the folder by hand to confirm the layout. Do not add the folder to the test.

3. **Check out the freeze** in a clean checkout of the repository. For example, run `git worktree add <somewhere outside ~/.blink-sealed> eval-freeze-1`, or use a fresh clone at that tag. Then copy `.env.local` into it and run `pnpm i`. Do not modify any tracked file.

4. **Run the eval once:**

   ```bash
   BLINK_LLM_MODE=live pnpm eval:real --set ~/.blink-sealed --policies oaktree,sage-rock,tcw --counts-only
   ```

   - **Output:** it prints counts and call ids only. Its error messages also print only codes.
   - **Stderr:** a failure inside the job runner can still print a whole error message to stderr. If the run fails, do not copy stderr anywhere; report the code only.
   - **Spend:** log what the script reports.

5. **Judge coverage** for every turn the run reports as extracted but not flagged, as Task 37 Step 5 does.
   - Read the policy text in `fixtures/real/policies/<policy>.md`. That is allowed, because it is not a prompt.
   - Write `~/.blink-sealed/<id>/coverage-<policy>.json` as `{ "<turn>": { "covered": true | false, "clause": "<the clause, quoted from the policy, or 'none'>" } }`.
   - Then re-score from the saved run without calling the model again, if the script allows it. If it does not, report the coverage judgement next to the counts.

6. **Write `docs/eval/2026-11-real-sealed.md`** with counts only.
   - **Per call and per policy:** labelled, hidden, not extracted, not flagged with a covering clause, not flagged without one, and other passages hidden.
   - **Pass bars:** the bars from section 11 of `docs/superpowers/specs/2026-11-10-live-guidance-design.md`, each with a plain yes or no:
     - at least 90% of the authority's passages hidden;
     - no faulted call comes back with nothing flagged;
     - at most one hidden passage per stay-quiet call, which is not measured here;
     - the same result on four of five repeat runs, which is not run here.
   - **Run details:** the tag's commit hash, the date and the spend.
   - **Nothing else from the material.** Commit only that file, on `main`, as `docs(eval): report the sealed run`.
