import { describe, expect, it } from "vitest";
import { addMonths, fiscalQuarterOfDate, isUnreported, lastReportedAsOf, monthsOfFiscalQuarter, resolvePeriod } from "@/core/evidence/fiscal";
import type { ClaimPeriod, IssuerFiscal } from "@/core/types";

// Halvorsen: FY2027 runs Feb 1 2026 – Jan 31 2027. Q1 Feb–Apr, Q2 May–Jul, Q3 Aug–Oct, Q4 Nov–Jan.
const fiscal: IssuerFiscal = { fiscal_year_end_month: 1, last_reported: { fy: 2027, q: 2, reported_on: "2026-09-08" }, next_report_expected: "2026-12-02" };
const CALL = "2026-11-03";
const period = (p: Partial<ClaimPeriod>): ClaimPeriod => ({ label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "unspecified", ...p });

describe("fiscal calendar", () => {
  it("places dates in the right fiscal quarter", () => {
    expect(fiscalQuarterOfDate("2026-02-01", 1)).toEqual({ fy: 2027, q: 1 });
    expect(fiscalQuarterOfDate("2026-07-31", 1)).toEqual({ fy: 2027, q: 2 });
    expect(fiscalQuarterOfDate("2026-10-31", 1)).toEqual({ fy: 2027, q: 3 });
    expect(fiscalQuarterOfDate(CALL, 1)).toEqual({ fy: 2027, q: 4 });
    expect(fiscalQuarterOfDate("2027-01-31", 1)).toEqual({ fy: 2027, q: 4 });
    expect(fiscalQuarterOfDate("2027-02-01", 1)).toEqual({ fy: 2028, q: 1 });
    // A calendar-year issuer.
    expect(fiscalQuarterOfDate("2026-11-03", 12)).toEqual({ fy: 2026, q: 4 });
  });

  it("lists the months of a fiscal quarter", () => {
    expect(monthsOfFiscalQuarter(2027, 3, 1)).toEqual([{ year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }]);
    expect(monthsOfFiscalQuarter(2027, 4, 1)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }]);
  });

  it("adds months with day clamping", () => {
    expect(addMonths("2026-07-15", 12)).toBe("2027-07-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-09-03", 14)).toBe("2026-11-03");
  });

  it("resolves 'this quarter' against the call date", () => {
    const r = resolvePeriod(period({ label: "this quarter", relative: "current" }), CALL, fiscal);
    expect(r).toMatchObject({ fy: 2027, q: 4, basis: "relative_current" });
  });

  it("an explicit fiscal quarter wins over 'current'", () => {
    const r = resolvePeriod(period({ label: "this quarter (Q3)", fiscal_year: 2027, fiscal_quarter: 3, relative: "current" }), CALL, fiscal);
    expect(r).toMatchObject({ fy: 2027, q: 3, basis: "fiscal" });
  });

  it("infers the fiscal year of a bare quarter from the call date", () => {
    expect(resolvePeriod(period({ fiscal_quarter: 3 }), CALL, fiscal)).toMatchObject({ fy: 2027, q: 3 });
    expect(resolvePeriod(period({ fiscal_quarter: 4 }), "2026-09-01", fiscal)).toMatchObject({ fy: 2026, q: 4 });
    expect(resolvePeriod(period({ fiscal_quarter: 4, relative: "future" }), "2026-09-01", fiscal)).toMatchObject({ fy: 2027, q: 4 });
  });

  // Fixture V4: "calendar Q3" is not fiscal Q3.
  it("maps calendar Q3 2026 onto fiscal Q2–Q3 FY2027, not fiscal Q3 of FY2026", () => {
    const r = resolvePeriod(period({ label: "calendar Q3", calendar_year: 2026, calendar_quarter: 3 }), CALL, fiscal)!;
    expect(r.basis).toBe("calendar");
    expect(r.spans).toEqual([{ fy: 2027, q: 2 }, { fy: 2027, q: 3 }]);
    expect({ fy: r.fy, q: r.q }).toEqual({ fy: 2027, q: 3 });
    // The naive reading would be Aug–Oct 2025:
    expect(resolvePeriod(period({ fiscal_year: 2026, fiscal_quarter: 3 }), CALL, fiscal)).toMatchObject({ fy: 2026, q: 3 });
  });

  it("calendar Q3 is unreported, calendar Q2 is reported (V4)", () => {
    expect(isUnreported(period({ calendar_year: 2026, calendar_quarter: 3 }), fiscal, CALL).status).toBe("unreported");
    expect(isUnreported(period({ calendar_year: 2026, calendar_quarter: 2 }), fiscal, CALL).status).toBe("reported");
    // Without a year, the most recent calendar Q3 before the call is meant.
    expect(isUnreported(period({ calendar_quarter: 3 }), fiscal, CALL).status).toBe("unreported");
  });

  it("compares against the last reported period", () => {
    expect(isUnreported(period({ fiscal_year: 2027, fiscal_quarter: 3 }), fiscal, CALL).status).toBe("unreported");
    expect(isUnreported(period({ fiscal_year: 2027, fiscal_quarter: 2 }), fiscal, CALL).status).toBe("reported");
    expect(isUnreported(period({ fiscal_year: 2026, fiscal_quarter: 4 }), fiscal, CALL).status).toBe("reported");
    expect(isUnreported(period({ relative: "current" }), fiscal, CALL).status).toBe("unreported");
    expect(isUnreported(period({ relative: "future" }), fiscal, CALL).status).toBe("unreported");
    expect(isUnreported(period({ label: "well before I left", relative: "prior" }), fiscal, CALL).status).toBe("reported");
    expect(isUnreported(period({}), fiscal, CALL).status).toBe("unknown");
  });

  it("treats a whole fiscal year as unreported until Q4 is reported", () => {
    expect(isUnreported(period({ fiscal_year: 2027 }), fiscal, CALL).status).toBe("unreported");
    expect(isUnreported(period({ fiscal_year: 2026 }), fiscal, CALL).status).toBe("reported");
  });

  it("ignores a report dated after the call", () => {
    // If the call had happened before the Q2 report came out, Q2 was still unreported.
    expect(lastReportedAsOf(fiscal, "2026-08-20")).toEqual({ fy: 2027, q: 1 });
    expect(isUnreported(period({ fiscal_year: 2027, fiscal_quarter: 2 }), fiscal, "2026-08-20").status).toBe("unreported");
  });
});
