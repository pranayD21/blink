# Gupta: Rajaratnam and Horowitz, 24 September 2008

- **Document:** *United States v. Gupta*, No. 12-4448, US Court of Appeals for the Second Circuit, opinion by Judge Kearse, decided 25 March 2014 (48 pages).
- **URL:** https://www.govinfo.gov/content/pkg/USCOURTS-ca2-12-04448/pdf/USCOURTS-ca2-12-04448-0.pdf
- **Fetched:** 2026-11-10, in Chrome (playwriter, `fetch` from a govinfo.gov page). SHA-256 of the PDF: `ef3288f085162e59035626d99903df1a889197a5c5e9717cd55fd6f9374a2463`.
- **Authority:** the Second Circuit, affirming Gupta's conviction for securities fraud and conspiracy based on insider trading.
- **Terms of use:** a work of the US federal courts, published by the Government Publishing Office on govinfo.gov. US government works are not subject to copyright in the United States (17 U.S.C. § 105); judicial opinions are public domain.

## source.txt

The full opinion, extracted with `pdftotext` (poppler 26.11.0) one page at a time, cropped to drop the left-margin line numbers and the running header and footer (`-x 70 -y 40 -W 542 -H 690`). Each page starts with a `[Page N of 48]` marker; slip-opinion page numbers equal PDF page numbers. Nothing else was changed. `pdftotext` joins words hyphenated across line ends (for example "selfinculpatory"); none of these fall inside a quoted call. The court's underlining ("emphases added") is not carried into the text.

## transcript.txt

Speakers as the opinion names them. Rajaratnam passes the information, so he is the expert; the person he speaks to is the analyst. Bracketed words (`[Muniyappa]`, `[i.e., unintelligible]`), `(UI)` and `(Laughs)` are the court's or the transcript's insertions, kept so every turn matches the source word for word; a spoken rendering should drop them.

This case joins the two wiretapped calls Rajaratnam placed to Ian Horowitz, Galleon's principal trader, before the market opened on 24 September 2008: the first at 7:09 a.m. (GX 21-T, slip op. p. 7) is T1 to T11, the second at 7:56 a.m. (GX 22-T, pp. 8-9) is T12 to T29. The opinion quotes each call as one excerpt, opening and closing with ellipses; it omits the start of the second call, where Rajaratnam asks how much Goldman stock Galleon owns.

## labels.json

Empty. The court relies on these calls in two ways. It finds the statements were in furtherance of the conspiracy "in which Gupta passed confidential Goldman Sachs information to Rajaratnam" (pp. 19-20). It also quotes T7 ("Saying something good might happen to Goldman") and T16 ("I got a call, right, saying something good's gonna happen") as statements against Rajaratnam's penal interest, that is, as admissions that exposed him to liability "for trading on the basis of inside information" (pp. 25-26). It never says that a statement in these calls conveyed inside information to Horowitz. By 7:09 a.m. the Buffett investment had also been public since about 6:00 p.m. the day before (p. 6). So, like `chu`, this is a call the authority faulted with no labeled passage. (A first draft labeled T7 and T16; the controller ruled in Task 35's fix round 1 that admissions are not the authority's own finding of conveyed inside information.)

The court also cites T28 ("AMD, IBM, everything") as corroborating wrongdoing (p. 26). That is about other companies' information and conveys none here.

## packet.json and expert.json

- Company, speakers, roles and dates: from the opinion (Goldman Sachs, p. 3; Rajaratnam "founder of The Galleon Group", p. 3, and "founder and head of Galleon", p. 28; Horowitz "his principal trader", p. 7; call times, p. 7).
- Ticker and fiscal calendar: from Goldman's filings on EDGAR. The 10-K for the year ended 28 November 2008 (https://www.sec.gov/Archives/edgar/data/886982/000095012309001278/0000950123-09-001278-index.htm, period of report 2008-11-28) gives the November year end. The Q3 2008 earnings release, filed on Form 8-K on 16 September 2008 (https://www.sec.gov/Archives/edgar/data/886982/000095012308011074/y71185exv99w1.htm), gives "NYSE: GS", the quarter ended 29 August 2008 and the report date used for `last_reported`.
- `next_report_expected` is null: the date Goldman expected to report on, as of the call, is not in the opinion or the filings used. (The Q4 loss was announced on 16 December 2008, p. 10.)
- Research question: the opinion gives none, because Rajaratnam placed the calls. The neutral text uses the opinion's words ("his report on the previous afternoon's events", p. 7).
- Expert employment dates, network and attestation: not in the opinion; left empty.
