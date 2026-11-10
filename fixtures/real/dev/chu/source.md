# Chu: C.B. Lee and Don Chu, 4 August 2009

- **Document:** US Attorney's Office, Southern District of New York, press release "Manhattan U.S. Attorney charges executive of expert-networking firm with conspiring to distribute inside information", 24 November 2010 (release 10-369, 4 pages). It summarises the criminal complaint against Don Ching Trang Chu.
- **URL:** https://www.justice.gov/archive/usao/nys/pressreleases/November10/chudonarrestpr.pdf
- **Fetched:** 2026-11-10, in Chrome (playwriter, `fetch` from a justice.gov page). SHA-256 of the PDF: `0be579530af25240e05c64701e7e4d6a88a2cb0fe30c62ac67e13821b127c07f`.
- **Authority:** the US Department of Justice (US Attorney, SDNY), reporting the complaint's allegations. The release itself says "the charges contained in the Complaint are merely accusations, and the defendants are presumed innocent unless and until proven guilty."
- **Terms of use:** a work of the US Department of Justice. US government works are not subject to copyright in the United States (17 U.S.C. § 105).

## source.txt

The whole release, extracted with `pdftotext` (poppler 26.11.0), with `[Page N of 4]` markers. The release's own page numbers ("-2-") are left in place.

## transcript.txt

The release quotes four separate conversations: Lee and a Firm employee (July 2009), Lee and Chu in person (4 August 2009), Chu and Lee by phone (28 August 2009, only the phrase "top line revenues"), and Chu and FBI agents (21 November 2010). Only the 4 August meeting quotes both sides in sequence, so this case is that meeting (page 3). It was a meeting, not a call.

- Lee is seeking the information, so he is the analyst; Chu arranges it, so he is the expert.
- Left out: Lee's question, quoted only as the fragments "you guys" and "nervous", which do not form a turn the source contains word for word.
- `(sic)`, `[the United States Securities and Exchange Commission]` and `[UI]` are the release's insertions, kept so every turn matches the source; a spoken rendering should drop them.

## labels.json

Empty. The release says Chu arranged for consultants to pass inside information. Its headings call the passages "The Tech Company Inside Information" and "The Broadcom Inside Information". But it does not say any quoted statement in this meeting conveyed inside information: Lee refers to a number CC-1 gave him without stating it, and Chu speaks about regulators and avoiding written records. The authority faults the conduct, not a passage.

## packet.json and expert.json

- From the release: Chu's role ("a liaison for the Firm to consultants and sources of information"), the Firm (unnamed), Lee (Richard Choo-Beng "C.B." Lee, who worked for a hedge fund that was the Firm's client), the date (4 August 2009), and the Tech Company (unnamed). The aliases are the release's own name for it.
- Ticker: `n/a`, because the company is not named. The app has no empty-ticker sentinel: the schema needs 1 to 10 characters, and `n/a` cannot match a real company name in `matchesIssuer`.
- Fiscal calendar: unknown because the company is not named. `fiscal_year_end_month` 12 and `last_reported` Q2 FY2009 are **placeholders**. The `reported_on` date, 21 July 2009, is from the release ("On July 20 and 21, 2009 ... Later that day, the Tech Company announced its quarterly earnings"; the later of the two days is used).
- Research question: none in the release; neutral text.
- Employment dates and attestation: not in the release; null and empty.
