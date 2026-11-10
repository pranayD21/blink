# Gupta: Rajaratnam and Lau, 24 October 2008

- **Document:** *United States v. Gupta*, No. 12-4448, US Court of Appeals for the Second Circuit, opinion by Judge Kearse, decided 25 March 2014 (48 pages).
- **URL:** https://www.govinfo.gov/content/pkg/USCOURTS-ca2-12-04448/pdf/USCOURTS-ca2-12-04448-0.pdf
- **Fetched:** 2026-11-10, in Chrome (playwriter, `fetch` from a govinfo.gov page). SHA-256 of the PDF: `ef3288f085162e59035626d99903df1a889197a5c5e9717cd55fd6f9374a2463`.
- **Authority:** the Second Circuit, affirming Gupta's conviction for securities fraud and conspiracy based on insider trading.
- **Terms of use:** a work of the US federal courts, published by the Government Publishing Office on govinfo.gov. US government works are not subject to copyright in the United States (17 U.S.C. § 105); judicial opinions are public domain.

## source.txt

The full opinion, extracted with `pdftotext` (poppler 26.11.0) one page at a time, cropped to drop the left-margin line numbers and the running header and footer (`-x 70 -y 40 -W 542 -H 690`). Each page starts with a `[Page N of 48]` marker; slip-opinion page numbers equal PDF page numbers. Nothing else was changed. `pdftotext` joins words hyphenated across line ends (for example "selfinculpatory"); none of these fall inside a quoted call. The court's underlining ("emphases added") is not carried into the text.

## transcript.txt

Speakers as the opinion names them. Rajaratnam passes the information, so he is the expert; the person he speaks to is the analyst. Bracketed words (`[Muniyappa]`, `[i.e., unintelligible]`), `(UI)` and `(Laughs)` are the court's or the transcript's insertions, kept so every turn matches the source word for word; a spoken rendering should drop them.

The call is GX 29-T, Rajaratnam returning a call to David Lau at 12:12 p.m. on 24 October 2008 (slip op. p. 10). The opinion quotes it in two excerpts: T1 to T12 (pp. 10-11) and T13 to T19 (pp. 11-12). Between them the court summarises, without quoting, how Rajaratnam began to describe the information ("from somebody who's on the Board of Goldman Sachs", p. 11). What was said in that gap, and how long it ran, is not known from the opinion.

## labels.json

The court calls these "statements about his inside information on Goldman Sachs to Lau" and quotes each one (pp. 26-27):

- **T13** ("I heard yesterday from somebody who's on the Board of Goldman Sachs, that they are gonna lose $2 per share"): also p. 11 ("the confidential negative information he had received the previous day") and p. 21 ("he had nonpublic information that ... Goldman's current quarter would not be profitable").
- **T15** ("they don't report until December"): also p. 11.
- **T17** ("So what he was telling me was that uh, Goldman, the quarter's pretty bad ... to date they have lost $2 per share"): pp. 26-27, including Goldman's "yet-to-be-announced '$2 per share' losses".

Not labeled: T1 to T11 (general market views, which the court contrasts with the inside information, p. 21) and T19 (his conclusion, quoted on p. 22 but not as inside information).

## packet.json and expert.json

- Company, speakers, roles and dates: from the opinion (Lau "a Singapore-based portfolio manager for Galleon International", p. 10; Lau "had sought to reach Rajaratnam for general investment advice", p. 10, and asked for "the pulse" of the market, p. 21, which gives the research question).
- Ticker and fiscal calendar: as for `gupta-horowitz`. Goldman's 10-K for the year ended 28 November 2008 (https://www.sec.gov/Archives/edgar/data/886982/000095012309001278/0000950123-09-001278-index.htm) and the Q3 2008 release on Form 8-K, 16 September 2008 (https://www.sec.gov/Archives/edgar/data/886982/000095012308011074/y71185exv99w1.htm). The opinion agrees: on 23 October Goldman was "more than halfway through the fourth quarter" of its fiscal year (p. 9).
- `next_report_expected` is null, as for `gupta-horowitz`.
- Expert employment dates, network and attestation: not in the opinion; left empty.
