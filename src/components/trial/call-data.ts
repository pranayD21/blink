/**
 * Word-timed ElevenLabs dialogue and real-time Blink engine snapshots for the
 * Halvorsen Pumps live call scenario.
 */

export type MonitorId = "M1" | "M2" | "M4";
export type FsmState = "UNASSESSED" | "NEEDS_CONTEXT" | "NOT_TRIGGERED" | "REVIEW_REQUIRED" | "ESCALATION_REQUESTED";
export type KleeneVal = "true" | "false" | "indeterminate";
export type EvidenceVal = "supported" | "refuted" | "unknown";

export interface TimedTurn {
  id: string;
  speaker: "analyst" | "expert";
  speakerName: string;
  roleLabel: string;
  start: number;
  end: number;
  text: string;
  flag?: "indeterminate" | "amber" | "red" | "cleared";
  flagNote?: string;
  words: readonly (readonly [string, number, number])[];
}

export interface PredicateEval {
  name: string;
  phrase: string;
  detail: string;
  evidence: EvidenceVal;
  tri: KleeneVal;
}

export interface MonitorSnapshot {
  id: MonitorId;
  ruleId: string;
  clause: string;
  title: string;
  terminalState: "REVIEW_REQUIRED" | "ESCALATION_REQUESTED";
  state: FsmState;
  prevState: FsmState | null;
  edgeResult: KleeneVal | null;
  formula: string;
  guardResult: KleeneVal;
  path: readonly { state: FsmState; at?: string }[];
  predicates: readonly PredicateEval[];
}

export interface FilingComparison {
  claimKey: string;
  docTitle: string;
  outcome: "mismatch" | "exact_match";
  expertSummary: string;
  filedSummary: string;
  rows: readonly { dimension: string; expert: string; filed: string; matches: boolean }[];
}

export interface EngineSnapshot {
  at: number;
  turnId: string;
  pill: { level: "listening" | "amber" | "red" | "ended"; text: string };
  stageLine: string;
  headline: string;
  summary: string;
  focusMonitor: MonitorId;
  timings: { sttMs: number; readerMs: number; reducerMs: number };
  filing: FilingComparison | null;
  monitors: Record<MonitorId, MonitorSnapshot>;
}

export const CALL_DURATION = 74;

export const CALL_MOMENTS = [
  { label: "0:00 Intro", time: 0 },
  { label: "0:22 20% drop", time: 22.48 },
  { label: "0:32 Amber warning", time: 32.48 },
  { label: "0:39 Red leak", time: 38.56 },
  { label: "1:02 Public steel", time: 61.68 },
] as const;

export const TURNS: readonly TimedTurn[] = [
  {
    id: "T1",
    speaker: "analyst",
    speakerName: "Priya Raman",
    roleLabel: "Banker · Blink Capital",
    start: 0,
    end: 7.84,
    text: "Ray, thanks for making time today. Just to confirm for our notes, you led West Coast sales at Halvorsen Pumps until mid-July, right?",
    words: [["Ray,",0,0.32],["thanks",0.35,0.56],["for",0.6,0.72],["making",0.75,0.96],["time",1.01,1.2],["today.",1.27,1.68],["Just",1.82,2.4],["to",2.43,2.48],["confirm",2.53,2.88],["for",2.92,3.04],["our",3.08,3.2],["notes,",3.27,3.92],["you",3.98,4.16],["led",4.22,4.4],["West",4.45,4.64],["Coast",4.69,4.96],["sales",5.01,5.28],["at",5.31,5.36],["Halvorsen",5.42,5.92],["Pumps",5.96,6.32],["until",6.37,6.64],["mid-July,",6.7,7.44],["right?",7.49,7.84]],
  },
  {
    id: "T2",
    speaker: "expert",
    speakerName: "Ray Castellano",
    roleLabel: "Former VP Sales, Halvorsen",
    start: 7.84,
    end: 15.04,
    text: "Yeah, that's right. Spent seven years at Halvorsen, wrapped up July fifteenth, and now I advise independent distributors.",
    words: [["Yeah,",7.84,8.64],["that's",8.66,8.8],["right.",8.83,9.04],["Spent",9.2,9.68],["seven",9.72,9.92],["years",9.96,10.16],["at",10.19,10.24],["Halvorsen,",10.3,11.2],["wrapped",11.24,11.52],["up",11.57,11.68],["July",11.73,11.92],["fifteenth,",12,12.56],["and",12.58,12.64],["now",12.72,12.96],["I",13.08,13.2],["advise",13.27,13.68],["independent",13.73,14.32],["distributors.",14.38,15.04]],
  },
  {
    id: "T3",
    speaker: "analyst",
    speakerName: "Priya Raman",
    roleLabel: "Banker · Blink Capital",
    start: 15.04,
    end: 22.48,
    text: "Great. Stepping back first, how is overall distributor demand across industrial pumps looking heading into year-end?",
    words: [["Great.",15.04,16.2],["Stepping",16.25,16.56],["back",16.61,16.8],["first,",16.88,17.68],["how",17.72,17.84],["is",17.92,18.08],["overall",18.14,18.56],["distributor",18.61,19.12],["demand",19.18,19.52],["across",19.58,19.92],["industrial",19.97,20.48],["pumps",20.53,20.8],["looking",20.85,21.2],["heading",21.24,21.52],["into",21.57,21.76],["year-end?",21.81,22.48]],
  },
  {
    id: "T4",
    speaker: "expert",
    speakerName: "Ray Castellano",
    roleLabel: "Former VP Sales, Halvorsen",
    start: 22.48,
    end: 32.48,
    flag: "indeterminate",
    flagNote: "Claim C1 · Needs context",
    text: "Honestly, orders fell off a cliff in September. Channel inventories were bloated from last year, so restocking is down roughly twenty percent.",
    words: [["Honestly,",22.48,23.92],["orders",24.29,24.56],["fell",24.59,24.72],["off",24.76,24.88],["a",24.92,24.96],["cliff",25.01,25.28],["in",25.31,25.36],["September.",25.42,26.16],["Channel",26.25,26.88],["inventories",26.93,27.52],["were",27.55,27.68],["bloated",27.74,28.16],["from",28.19,28.32],["last",28.38,28.64],["year,",28.7,29.36],["so",29.47,29.68],["restocking",29.78,30.48],["is",30.51,30.56],["down",30.61,30.8],["roughly",30.84,31.12],["twenty",31.15,31.36],["percent.",31.43,32.48]],
  },
  {
    id: "T5",
    speaker: "analyst",
    speakerName: "Priya Raman",
    roleLabel: "Banker · Blink Capital",
    start: 32.48,
    end: 38.56,
    flag: "amber",
    flagNote: "Amber · Question probe",
    text: "When you say down twenty percent, are Halvorsen's own third-quarter bookings tracking down that much right now?",
    words: [["When",32.48,32.56],["you",32.62,32.8],["say",32.84,32.96],["down",33.04,33.36],["twenty",33.39,33.6],["percent,",33.66,34.48],["are",34.52,34.64],["Halvorsen's",34.68,35.28],["own",35.36,35.6],["third-quarter",35.65,36.24],["bookings",36.3,36.8],["tracking",36.85,37.28],["down",37.34,37.6],["that",37.63,37.76],["much",37.81,38],["right",38.03,38.16],["now?",38.24,38.56]],
  },
  {
    id: "T6",
    speaker: "expert",
    speakerName: "Ray Castellano",
    roleLabel: "Former VP Sales, Halvorsen",
    start: 38.56,
    end: 52.48,
    flag: "red",
    flagNote: "Red · Sealed (R1, R2, R4)",
    text: "Yeah, that twenty percent is Halvorsen's West region for Q3. IT never shut off my old Salesforce pipeline login when I left, and when I checked last week, Q3 bookings were down nineteen point eight percent year over year.",
    words: [["Yeah,",38.56,39.68],["that",39.7,39.76],["twenty",39.79,40],["percent",40.05,40.4],["is",40.43,40.48],["Halvorsen's",40.52,41.04],["West",41.1,41.36],["region",41.41,41.68],["for",41.74,41.92],["Q3.",42.08,42.8],["IT",43.07,43.6],["never",43.63,43.76],["shut",43.81,44],["off",44.04,44.16],["my",44.21,44.32],["old",44.36,44.48],["Salesforce",44.53,45.04],["pipeline",45.09,45.52],["login",45.59,45.92],["when",45.94,46],["I",46.08,46.16],["left,",46.22,47.04],["and",47.06,47.12],["when",47.15,47.28],["I",47.32,47.36],["checked",47.4,47.68],["last",47.73,47.92],["week,",47.98,48.72],["Q3",48.84,49.12],["bookings",49.16,49.52],["were",49.55,49.68],["down",49.73,49.92],["nineteen",49.97,50.4],["point",50.48,50.88],["eight",50.89,50.96],["percent",51.04,51.6],["year",51.66,51.92],["over",51.97,52.16],["year.",52.22,52.48]],
  },
  {
    id: "T7",
    speaker: "analyst",
    speakerName: "Priya Raman",
    roleLabel: "Banker · Blink Capital",
    start: 52.48,
    end: 61.68,
    text: "Hold on, let's stay away from anything internal to Halvorsen. Sticking strictly to public industry data, how are steel costs affecting pump makers?",
    words: [["Hold",52.48,53.36],["on,",53.41,53.68],["let's",53.72,53.92],["stay",53.97,54.16],["away",54.19,54.32],["from",54.37,54.56],["anything",54.6,54.96],["internal",55.01,55.44],["to",55.49,55.6],["Halvorsen.",55.64,56.56],["Sticking",56.61,56.96],["strictly",57,57.36],["to",57.41,57.52],["public",57.57,57.84],["industry",57.88,58.24],["data,",58.32,59.12],["how",59.16,59.28],["are",59.32,59.44],["steel",59.49,59.76],["costs",59.85,60.32],["affecting",60.37,60.8],["pump",60.85,61.04],["makers?",61.13,61.68]],
  },
  {
    id: "T8",
    speaker: "expert",
    speakerName: "Ray Castellano",
    roleLabel: "Former VP Sales, Halvorsen",
    start: 61.68,
    end: 74,
    flag: "cleared",
    flagNote: "Claim C2 · Public match",
    text: "Of course, sorry about that. From the public trade press, hot-rolled steel is up around twelve percent over six months, though most manufacturers pushed through two catalog price increases this year.",
    words: [["Of",61.68,62.64],["course,",62.69,63.08],["sorry",63.1,63.2],["about",63.24,63.44],["that.",63.49,63.92],["From",64.03,64.48],["the",64.5,64.56],["public",64.61,64.88],["trade",64.93,65.2],["press,",65.27,65.92],["hot-rolled",65.98,66.4],["steel",66.48,66.88],["is",66.96,67.12],["up",67.17,67.28],["around",67.31,67.52],["twelve",67.57,67.84],["percent",67.91,68.4],["over",68.47,68.72],["six",68.78,68.96],["months,",69.02,69.92],["though",69.95,70.16],["most",70.21,70.4],["manufacturers",70.47,71.36],["pushed",71.39,71.6],["through",71.65,72],["two",72.06,72.24],["catalog",72.3,72.72],["price",72.77,73.04],["increases",73.09,73.52],["this",73.57,73.76],["year.",73.81,74]],
  },
];

const MISMATCH_FILING: FilingComparison = {
  claimKey: "C1",
  docTitle: "Halvorsen Form 10-Q · Q2 FY27 (filed Sep 8)",
  outcome: "mismatch",
  expertSummary: "Down 19.8% YoY · Q3 West",
  filedSummary: "Down 8.0% YoY · Q2 Total",
  rows: [
    { dimension: "Period", expert: "Q3 FY27 (unreported until Dec 2)", filed: "Q2 FY27 (reported Sep 8)", matches: false },
    { dimension: "Scope", expert: "West region bookings", filed: "Company-wide orders", matches: false },
    { dimension: "Figure", expert: "-19.8% YoY", filed: "-8.0% YoY", matches: false },
    { dimension: "Source", expert: "Active Salesforce login", filed: "SEC Form 10-Q", matches: false },
  ],
};

const PUBLIC_STEEL_FILING: FilingComparison = {
  claimKey: "C2",
  docTitle: "Steel & Castings Market Note (Oct 2026)",
  outcome: "exact_match",
  expertSummary: "Hot-rolled steel +12% over 6 mo",
  filedSummary: "Hot-rolled coil +12% over 6 mo",
  rows: [
    { dimension: "Subject", expert: "Industry pump manufacturers", filed: "Industrial equipment sector", matches: true },
    { dimension: "Figure", expert: "+12% over 6 months", filed: "+12% over 6 months", matches: true },
    { dimension: "Source", expert: "Public trade press", filed: "Published trade note", matches: true },
  ],
};

const baseMonitors = (recentEmployeeKnown: boolean): Record<MonitorId, MonitorSnapshot> => ({
  M1: {
    id: "M1",
    ruleId: "R1",
    clause: "P2",
    title: "Internal operating figure",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    formula: "and(covered_issuer, operating_metric, internal_source)",
    guardResult: "indeterminate",
    path: [{ state: "UNASSESSED" }],
    predicates: [
      { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "No claim extracted yet", evidence: "unknown", tri: "indeterminate" },
      { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Waiting for a number", evidence: "unknown", tri: "indeterminate" },
      { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "No source stated", evidence: "unknown", tri: "indeterminate" },
    ],
  },
  M2: {
    id: "M2",
    ruleId: "R2",
    clause: "P3",
    title: "Post-employment access",
    terminalState: "ESCALATION_REQUESTED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    formula: "and(post_employment_access, internal_source)",
    guardResult: "indeterminate",
    path: [{ state: "UNASSESSED" }],
    predicates: [
      { name: "post_employment_access", phrase: "Accessed systems after leaving", detail: recentEmployeeKnown ? "Left Halvorsen Jul 15; no access claimed" : "Employment dates pending", evidence: "unknown", tri: "indeterminate" },
      { name: "internal_source_claimed", phrase: "Internal system or document", detail: "No internal source stated", evidence: "unknown", tri: "indeterminate" },
    ],
  },
  M4: {
    id: "M4",
    ruleId: "R4",
    clause: "P5",
    title: "Recent employee (<12 mo)",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    formula: "and(recent_employee_12m, covered_issuer, operating_metric, unreported_period, not(public_match))",
    guardResult: "indeterminate",
    path: [{ state: "UNASSESSED" }],
    predicates: [
      {
        name: "expert_recent_issuer_employee",
        phrase: "Left Halvorsen within 12 months",
        detail: recentEmployeeKnown ? "Left 2026-07-15 (3.6 mo before call)" : "Checking employment end date",
        evidence: recentEmployeeKnown ? "supported" : "unknown",
        tri: recentEmployeeKnown ? "true" : "indeterminate",
      },
      { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "No operating claim yet", evidence: "unknown", tri: "indeterminate" },
      { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "No metric stated", evidence: "unknown", tri: "indeterminate" },
      { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Q3 FY27 reports Dec 2", evidence: "unknown", tri: "indeterminate" },
      { name: "not_public_match", phrase: "Not verified in public filings", detail: "No filing comparison yet", evidence: "unknown", tri: "indeterminate" },
    ],
  },
});

export const SNAPSHOTS: readonly EngineSnapshot[] = [
  {
    at: 0,
    turnId: "T1",
    pill: { level: "listening", text: "Listening" },
    stageLine: "Hearing · Deepgram Flux",
    headline: "Listening to both channels with the case packet pinned",
    summary: "Blink hears Priya on the mic and Ray on call audio. Halvorsen's Q2 Form 10-Q (-8% orders) and fiscal calendar (Q3 reports Dec 2) are loaded in memory.",
    focusMonitor: "M4",
    timings: { sttMs: 118, readerMs: 310, reducerMs: 0.2 },
    filing: null,
    monitors: baseMonitors(false),
  },
  {
    at: 12.2,
    turnId: "T2",
    pill: { level: "listening", text: "Listening" },
    stageLine: "Profile verified · 340 ms",
    headline: "Former-employee window armed (3.6 months since exit)",
    summary: "Ray confirmed he left Halvorsen on July 15. Because 3.6 months is inside the 12-month cooling-off rule (P5), Monitor M4 sets recent_employee to true and watches for current-quarter figures.",
    focusMonitor: "M4",
    timings: { sttMs: 124, readerMs: 340, reducerMs: 0.3 },
    filing: null,
    monitors: baseMonitors(true),
  },
  {
    at: 21.5,
    turnId: "T3",
    pill: { level: "listening", text: "Listening" },
    stageLine: "Question probe · 360 ms",
    headline: "Broad industry question cleared under P6",
    summary: "Priya asked how distributor demand looks across industrial pumps broadly. Topic subject is industry, so covered_issuer evaluates false and the banker pill stays quiet.",
    focusMonitor: "M4",
    timings: { sttMs: 130, readerMs: 360, reducerMs: 0.3 },
    filing: null,
    monitors: baseMonitors(true),
  },
  {
    at: 31.2,
    turnId: "T4",
    pill: { level: "listening", text: "Listening" },
    stageLine: "Claim C1 · Kleene indeterminate · 540 ms",
    headline: "20% drop extracted; missing scope moves FSM to Needs context",
    summary: "Ray said orders fell 20% in September without specifying Halvorsen or naming a source. Three-valued logic evaluates indeterminate, moving M1 and M4 to Needs context without a false alarm.",
    focusMonitor: "M4",
    timings: { sttMs: 136, readerMs: 540, reducerMs: 0.4 },
    filing: null,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Ambiguous: channel vs Halvorsen", evidence: "unknown", tri: "indeterminate" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Orders down ~20% in September", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Source unstated in T4", evidence: "unknown", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15 (3.6 mo ago)", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Ambiguous: channel vs Halvorsen", evidence: "unknown", tri: "indeterminate" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Orders down ~20%", evidence: "supported", tri: "true" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "September sits inside unreported Q3 FY27", evidence: "supported", tri: "true" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "Waiting for issuer confirmation", evidence: "unknown", tri: "indeterminate" },
        ],
      },
    },
  },
  {
    at: 32.48,
    turnId: "T5",
    pill: { level: "amber", text: "Getting close to inside information. Steer away." },
    stageLine: "Question probe · Amber · 380 ms",
    headline: "Amber warning on Priya's question before Ray answers",
    summary: "Priya asked whether Halvorsen's own Q3 bookings are down 20%. The question probe sees covered_issuer + bookings + unreported Q3 and warns Priya to steer away before Ray speaks.",
    focusMonitor: "M4",
    timings: { sttMs: 128, readerMs: 380, reducerMs: 0.4 },
    filing: null,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Probe: question names Halvorsen", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Probe: asks for Q3 bookings", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Awaiting expert's source", evidence: "unknown", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15 (3.6 mo ago)", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Probe: question names Halvorsen", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Probe: asks for Q3 bookings", evidence: "supported", tri: "true" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Q3 FY27 is unreported until Dec 2", evidence: "supported", tri: "true" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "No Q3 filing exists yet", evidence: "supported", tri: "true" },
        ],
      },
    },
  },
  {
    at: 42.1,
    turnId: "T6",
    pill: { level: "red", text: "Sounds like inside information. Move on." },
    stageLine: "Rule R4 met · Red · 510 ms",
    headline: "Red: recent former employee gave unreported Q3 Halvorsen bookings",
    summary: "Ray confirmed the 20% drop is Halvorsen's West region in Q3. Because Q3 is unreported and the Q2 10-Q showed -8% company-wide, Monitor M4 evaluates true and flips the pill Red.",
    focusMonitor: "M4",
    timings: { sttMs: 140, readerMs: 510, reducerMs: 0.4 },
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Halvorsen West region", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "West Q3 bookings -20%", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Listening to rest of sentence", evidence: "unknown", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }, { state: "REVIEW_REQUIRED", at: "T6" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15 (3.6 mo <= 12 mo)", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Halvorsen West region", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Q3 bookings down 20%", evidence: "supported", tri: "true" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Q3 FY27 unreported until Dec 2", evidence: "supported", tri: "true" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "10-Q Q2 was -8% total, not -20% Q3 West", evidence: "supported", tri: "true" },
        ],
      },
    },
  },
  {
    at: 46.2,
    turnId: "T6",
    pill: { level: "red", text: "Sounds like inside information. Move on." },
    stageLine: "Rules R1, R2, R4 · Escalated · 610 ms",
    headline: "Escalated: active Salesforce login after employment ended (-19.8% Q3)",
    summary: "Ray disclosed an active login to Halvorsen's Salesforce dashboard and cited -19.8% Q3 bookings. M1 hits Review required, M2 hits Escalation requested, and T4 + T6 are sealed.",
    focusMonitor: "M2",
    timings: { sttMs: 142, readerMs: 610, reducerMs: 0.5 },
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }, { state: "REVIEW_REQUIRED", at: "T6" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Halvorsen West region", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Q3 bookings -19.8% YoY", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Salesforce pipeline dashboard", evidence: "supported", tri: "true" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "ESCALATION_REQUESTED", at: "T6" }],
        predicates: [
          { name: "post_employment_access", phrase: "Accessed systems after leaving", detail: "Left Jul 15; checked Salesforce last week", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Internal system or document", detail: "Salesforce pipeline login", evidence: "supported", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }, { state: "REVIEW_REQUIRED", at: "T6" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15 (3.6 mo <= 12 mo)", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Halvorsen West region", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Q3 bookings -19.8% YoY", evidence: "supported", tri: "true" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Q3 FY27 unreported until Dec 2", evidence: "supported", tri: "true" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "Mismatch vs Form 10-Q (-8% Q2)", evidence: "supported", tri: "true" },
        ],
      },
    },
  },
  {
    at: 56.5,
    turnId: "T7",
    pill: { level: "listening", text: "Listening" },
    stageLine: "Topic redirected · 330 ms",
    headline: "Priya steered away to public industry steel costs",
    summary: "Seeing the Red pill, Priya cut off Halvorsen internals and asked about public steel costs across pump makers. Claim C1 stays sealed in the background for compliance.",
    focusMonitor: "M2",
    timings: { sttMs: 126, readerMs: 330, reducerMs: 0.3 },
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }, { state: "REVIEW_REQUIRED", at: "T6" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Claim C1 pinned on T4 + T6", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Q3 bookings -19.8% YoY", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Salesforce pipeline dashboard", evidence: "supported", tri: "true" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "ESCALATION_REQUESTED", at: "T6" }],
        predicates: [
          { name: "post_employment_access", phrase: "Accessed systems after leaving", detail: "Left Jul 15; checked Salesforce last week", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Internal system or document", detail: "Salesforce pipeline login", evidence: "supported", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "NEEDS_CONTEXT", at: "T4" }, { state: "REVIEW_REQUIRED", at: "T6" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15 (3.6 mo <= 12 mo)", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "Halvorsen West region", evidence: "supported", tri: "true" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Q3 bookings -19.8% YoY", evidence: "supported", tri: "true" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Q3 FY27 unreported until Dec 2", evidence: "supported", tri: "true" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "Mismatch vs Form 10-Q (-8% Q2)", evidence: "supported", tri: "true" },
        ],
      },
    },
  },
  {
    at: 68.5,
    turnId: "T8",
    pill: { level: "ended", text: "Call ended. 1 passage hidden and sent to compliance." },
    stageLine: "Claim C2 cleared · 1 passage sealed · 480 ms",
    headline: "Public steel figure (+12%) cleared; Salesforce passage stays sealed",
    summary: "Ray's hot-rolled steel remark (+12% from trade press) matches the published market note, so Claim C2 evaluates Not triggered and is cleared for the brief. Finding F1 (T4 + T6) awaits compliance.",
    focusMonitor: "M1",
    timings: { sttMs: 134, readerMs: 480, reducerMs: 0.4 },
    filing: PUBLIC_STEEL_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NOT_TRIGGERED",
        prevState: "UNASSESSED",
        edgeResult: "false",
        guardResult: "false",
        path: [{ state: "UNASSESSED" }, { state: "NOT_TRIGGERED", at: "T8 (C2)" }],
        predicates: [
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "C2 is industry-wide steel press", evidence: "refuted", tri: "false" },
          { name: "company_specific_operating_metric", phrase: "Company operating figure", detail: "Industry hot-rolled coil +12%", evidence: "refuted", tri: "false" },
          { name: "internal_source_claimed", phrase: "Attributed to internal system", detail: "Public trade press", evidence: "refuted", tri: "false" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        path: [{ state: "UNASSESSED" }, { state: "ESCALATION_REQUESTED", at: "T6 (C1)" }],
        predicates: [
          { name: "post_employment_access", phrase: "Accessed systems after leaving", detail: "C1: checked Salesforce last week", evidence: "supported", tri: "true" },
          { name: "internal_source_claimed", phrase: "Internal system or document", detail: "C1: Salesforce pipeline login", evidence: "supported", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "NOT_TRIGGERED",
        prevState: "UNASSESSED",
        edgeResult: "false",
        guardResult: "false",
        path: [{ state: "UNASSESSED" }, { state: "NOT_TRIGGERED", at: "T8 (C2)" }],
        predicates: [
          { name: "expert_recent_issuer_employee", phrase: "Left Halvorsen within 12 months", detail: "Left 2026-07-15", evidence: "supported", tri: "true" },
          { name: "about_covered_issuer", phrase: "About Halvorsen Pumps", detail: "C2 is industry-wide (P6 exception)", evidence: "refuted", tri: "false" },
          { name: "company_specific_operating_metric", phrase: "Operating metric stated", detail: "Industry input cost, not issuer", evidence: "refuted", tri: "false" },
          { name: "current_or_unreported_period", phrase: "Current unreported period (Q3)", detail: "Trailing 6-month public trend", evidence: "refuted", tri: "false" },
          { name: "not_public_match", phrase: "Not verified in public filings", detail: "Exact match in Oct 2026 market note", evidence: "refuted", tri: "false" },
        ],
      },
    },
  },
];

export function snapshotAt(seconds: number): EngineSnapshot {
  let chosen = SNAPSHOTS[0];
  for (const snap of SNAPSHOTS) {
    if (seconds >= snap.at) chosen = snap;
  }
  return chosen;
}

export function activeTurnAt(seconds: number): TimedTurn {
  for (const turn of TURNS) {
    if (seconds >= turn.start && seconds < turn.end) return turn;
  }
  return seconds >= CALL_DURATION ? TURNS[TURNS.length - 1] : TURNS[0];
}

export function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.min(CALL_DURATION, Math.floor(seconds)));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
