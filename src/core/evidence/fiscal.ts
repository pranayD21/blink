/**
 * Fiscal-calendar period resolution (§7.4).
 *
 * A fiscal year is labelled by the calendar year in which it ends: with
 * `fiscal_year_end_month = 1`, FY2027 runs Feb 2026 – Jan 2027. Experts mix
 * fiscal terms ("Q3"), calendar terms ("calendar Q3") and relative terms
 * ("this quarter"); this module maps all three onto fiscal quarters so the
 * model never has to do date arithmetic.
 */
import type { ClaimPeriod, FiscalPeriod, IssuerFiscal, Quarter } from "../types";

export interface YearMonth {
  year: number;
  month: number; // 1..12
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Compares two ISO dates by their date part. */
export function compareIsoDates(a: string, b: string): number {
  const x = a.slice(0, 10);
  const y = b.slice(0, 10);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Adds whole months to an ISO date, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(iso: string, months: number): string | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d.day, lastDay);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The fiscal quarter that contains a calendar month. */
export function fiscalQuarterOfMonth(ym: YearMonth, fiscalYearEndMonth: number): { fy: number; q: Quarter } {
  const fy = ym.month > fiscalYearEndMonth ? ym.year + 1 : ym.year;
  const monthIndex = (ym.month - fiscalYearEndMonth - 1 + 12) % 12; // 0 = first month of the fiscal year
  return { fy, q: (Math.floor(monthIndex / 3) + 1) as Quarter };
}

export function fiscalQuarterOfDate(iso: string, fiscalYearEndMonth: number): { fy: number; q: Quarter } | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  return fiscalQuarterOfMonth({ year: d.year, month: d.month }, fiscalYearEndMonth);
}

/** The three calendar months of a fiscal quarter, in order. */
export function monthsOfFiscalQuarter(fy: number, q: Quarter, fiscalYearEndMonth: number): YearMonth[] {
  const out: YearMonth[] = [];
  for (let k = 3 * (q - 1); k < 3 * q; k++) {
    const month = ((fiscalYearEndMonth + k) % 12) + 1;
    out.push({ year: month > fiscalYearEndMonth ? fy - 1 : fy, month });
  }
  return out;
}

export function previousQuarter(p: { fy: number; q: Quarter }): { fy: number; q: Quarter } {
  return p.q === 1 ? { fy: p.fy - 1, q: 4 } : { fy: p.fy, q: (p.q - 1) as Quarter };
}

export function formatFiscalPeriod(p: FiscalPeriod | null): string {
  if (!p) return "unspecified";
  return p.q ? `Q${p.q} FY${p.fy}` : `FY${p.fy}`;
}

export interface ResolvedPeriod extends FiscalPeriod {
  basis: "fiscal" | "calendar" | "relative_current";
  /**
   * Every fiscal quarter the stated period touches. A calendar quarter can
   * straddle two fiscal quarters; `fy`/`q` then name the latest one.
   */
  spans: { fy: number; q: Quarter }[];
  note: string;
}

/**
 * Resolves a claim's period to a fiscal period, or null when the claim gives
 * nothing to anchor on ("a while back", unspecified).
 */
export function resolvePeriod(period: ClaimPeriod, callDate: string, fiscal: IssuerFiscal): ResolvedPeriod | null {
  const endMonth = fiscal.fiscal_year_end_month;
  const current = fiscalQuarterOfDate(callDate, endMonth);

  // 1. Explicit fiscal quarter (with or without a year).
  if (period.fiscal_quarter) {
    const q = period.fiscal_quarter;
    if (period.fiscal_year) {
      return { fy: period.fiscal_year, q, basis: "fiscal", spans: [{ fy: period.fiscal_year, q }], note: "stated fiscal quarter" };
    }
    if (!current) return null;
    // No year given: the most recent such quarter, unless the expert spoke about the future.
    const fy = q <= current.q || period.relative === "future" ? current.fy : current.fy - 1;
    return { fy, q, basis: "fiscal", spans: [{ fy, q }], note: `fiscal year inferred from call date ${callDate}` };
  }

  // 2. Explicit fiscal year only.
  if (period.fiscal_year) {
    return { fy: period.fiscal_year, q: null, basis: "fiscal", spans: [], note: "stated fiscal year" };
  }

  // 3. Calendar quarter: map each month onto the fiscal calendar.
  if (period.calendar_quarter) {
    const cq = period.calendar_quarter;
    let year = period.calendar_year;
    if (!year) {
      const call = parseIsoDate(callDate);
      if (!call) return null;
      const callCq = Math.floor((call.month - 1) / 3) + 1;
      year = cq <= callCq || period.relative === "future" ? call.year : call.year - 1;
    }
    const spans: { fy: number; q: Quarter }[] = [];
    for (let month = 3 * cq - 2; month <= 3 * cq; month++) {
      const fq = fiscalQuarterOfMonth({ year, month }, endMonth);
      if (!spans.some((s) => s.fy === fq.fy && s.q === fq.q)) spans.push(fq);
    }
    const last = spans[spans.length - 1];
    const note =
      spans.length > 1
        ? `calendar Q${cq} ${year} straddles ${spans.map((s) => formatFiscalPeriod(s)).join(" and ")}`
        : `calendar Q${cq} ${year} is ${formatFiscalPeriod(last)}`;
    return { fy: last.fy, q: last.q, basis: "calendar", spans, note };
  }

  // 4. Calendar year only: the fiscal year that contains its December.
  if (period.calendar_year) {
    const fq = fiscalQuarterOfMonth({ year: period.calendar_year, month: 12 }, endMonth);
    return { fy: fq.fy, q: null, basis: "calendar", spans: [], note: `calendar year ${period.calendar_year}` };
  }

  // 5. "This quarter", "right now": the fiscal quarter containing the call date.
  if (period.relative === "current" && current) {
    return { ...current, basis: "relative_current", spans: [current], note: `current quarter as of call date ${callDate}` };
  }

  return null;
}

/** The issuer's last reported quarter as of a date (a report dated after the call does not count yet). */
export function lastReportedAsOf(fiscal: IssuerFiscal, asOf: string): { fy: number; q: Quarter } {
  const lr = { fy: fiscal.last_reported.fy, q: fiscal.last_reported.q };
  if (fiscal.last_reported.reported_on && compareIsoDates(fiscal.last_reported.reported_on, asOf) > 0) {
    return previousQuarter(lr);
  }
  return lr;
}

function isAfter(p: FiscalPeriod, lastReported: { fy: number; q: Quarter }): boolean {
  if (p.fy !== lastReported.fy) return p.fy > lastReported.fy;
  // A whole fiscal year is unreported until its fourth quarter has been reported.
  if (p.q === null) return lastReported.q < 4;
  return p.q > lastReported.q;
}

export type ReportedStatus = "unreported" | "reported" | "unknown";

export interface ReportedCheck {
  status: ReportedStatus;
  resolved: ResolvedPeriod | null;
  lastReported: { fy: number; q: Quarter };
  explanation: string;
}

/**
 * Is the claim's period after the issuer's last reported period as of the call
 * date? A period that touches any unreported quarter counts as unreported.
 */
export function isUnreported(period: ClaimPeriod, fiscal: IssuerFiscal, callDate: string): ReportedCheck {
  const lastReported = lastReportedAsOf(fiscal, callDate);
  const lastLabel = formatFiscalPeriod(lastReported);
  const resolved = resolvePeriod(period, callDate, fiscal);

  if (resolved) {
    const parts = resolved.spans.length > 0 ? resolved.spans : [resolved];
    const unreported = parts.some((p) => isAfter(p, lastReported));
    return {
      status: unreported ? "unreported" : "reported",
      resolved,
      lastReported,
      explanation: unreported
        ? `${formatFiscalPeriod(resolved)} (${resolved.note}) is after the last reported period ${lastLabel}`
        : `${formatFiscalPeriod(resolved)} (${resolved.note}) is at or before the last reported period ${lastLabel}`,
    };
  }

  if (period.relative === "future") {
    return { status: "unreported", resolved: null, lastReported, explanation: `a future period is after the last reported period ${lastLabel}` };
  }
  if (period.relative === "prior") {
    return {
      status: "reported",
      resolved: null,
      lastReported,
      explanation: `the claim refers to a prior period${period.label ? ` ("${period.label}")` : ""}, not the current or an unreported one`,
    };
  }
  return { status: "unknown", resolved: null, lastReported, explanation: "the claim does not say which period it covers" };
}

export function sameFiscalPeriod(a: FiscalPeriod, b: FiscalPeriod): boolean {
  return a.fy === b.fy && a.q === b.q;
}
