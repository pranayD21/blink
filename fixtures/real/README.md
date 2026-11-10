# Real test material

Calls quoted in public court and Justice Department documents (spec section 11). The words are real. Each turn is copied from the authority's document, and a turn is labeled only where the authority itself says it conveyed inside information.

## Development set: `dev/`

This set may be read, and prompts may be fixed against it.

| Case | Source | Turns | Labeled turns |
|---|---|---|---|
| `gupta-horowitz` | *US v. Gupta*, 2d Cir. 2014, two wiretapped calls, Rajaratnam to Horowitz, 24 Sep 2008 | 29 | 0 |
| `gupta-lau` | *US v. Gupta*, 2d Cir. 2014, wiretapped call, Rajaratnam to Lau, 24 Oct 2008 | 19 | 3 |
| `chu` | DOJ (SDNY) release on Don Chu, 2010, Lee and Chu meeting, 4 Aug 2009 | 4 | 0 |

That is 52 turns and 3 labeled statements in the repository. It is a small test and is reported as one, with counts per call. Two more development cases are kept privately (below).

Each case folder has:

- `source.md`: URL, date fetched, the PDF's SHA-256, the authority, the page for every fact used, the terms of use, and every judgment call.
- `source.txt`: the document's full text, extracted with `pdftotext` and marked by page.
- `transcript.txt`: only words the document quotes, in the document's order, as `Expert (Name): text` / `Analyst (Name): text`. The person passing the information is the expert; the person receiving it is the analyst. Bracketed insertions such as `[Rosenbach]`, `(UI)` and `(sic)` are the authority's own, kept so each turn matches the source word for word; drop them when reading a call aloud.
- `speakers.json`: each speaker's name and the role they should parse to.
- `packet.json`, `expert.json`: in the shape of `fixtures/cases/halvorsen/`, filled from the document. Fiscal facts come from a public filing named in `source.md`. Values the documents do not give are neutral placeholders, and `source.md` says which. When the company has no ticker, `ticker` is `n/a`: the app has no empty-ticker sentinel, because the schema needs 1 to 10 characters.
- `labels.json`: `{ "labels": [{ "turn", "authority_says": "inside_information", "cite" }] }`.

`tests/core/real-fixtures.test.ts` checks each case:

- every turn is in `source.txt`, word for word and in order;
- each speaker parses to the role in `speakers.json`;
- every label names a real turn and has a citation;
- the packet loads as a case.

The prompt-leak test (`tests/core/prompt-leak.test.ts`) reads every `transcript.txt` here.

## Private development cases: `~/.blink-real-local/dev/`

Two cases built from a UK regulator's final notice (the FSA's 2012 notice on Kyprios) are kept outside the repository, in `~/.blink-real-local/dev/kyprios-1` and `kyprios-2`, with the same layout. The regulator's site terms forbid placing its documents in any public or private retrieval system without permission. This repository is public, so the owner decided they must not be in any commit. When that folder exists, the real-fixtures test and the prompt-leak test read it too; when it is absent, they skip it. Its own `source.md` files record the source, terms and labels.

## Fewer calls than planned, and why

- **The documents quote fragments, not whole calls.** Gupta quotes about 50 turns in full. The Chu release quotes only one conversation in sequence, so that case is very short.
- **`gupta-horowitz` has no labels.** The court quotes Rajaratnam's statements to Horowitz as admissions against his own interest. It does not say that they conveyed inside information to Horowitz. It is kept as a call the authority faulted.
- **`chu` has no labels.** The release faults the conduct but never says that a quoted statement in the meeting conveyed inside information. Its other conversations are too fragmentary to form a call: Lee with a Firm employee, Chu with Lee by phone (only "top line revenues" is quoted), and Chu with FBI agents.
- **The scanned Justice Department complaints from the Galleon cases are not included.** The plan names no documents or URLs for them. They have not been fetched or OCR'd, and the brief's ten-quote spot check has not been run.

## Copyright and terms

*US v. Gupta* (govinfo.gov) and the Chu release (justice.gov) are US government works, not subject to copyright in the US (17 U.S.C. § 105).

## Sealed set

The sealed test set is prepared and run by a separate, isolated session and is kept outside this repository. Nothing from it belongs here. A test checks that no `sealed` folder exists here.
