/**
 * Word-timed ElevenLabs dialogue and plain-English Blink engine snapshots for
 * the Halvorsen Pumps live call scenario.
 */

export type MonitorId = "M1" | "M2" | "M4";
export type FsmState = "UNASSESSED" | "NEEDS_CONTEXT" | "NOT_TRIGGERED" | "REVIEW_REQUIRED" | "ESCALATION_REQUESTED";
export type KleeneVal = "true" | "false" | "indeterminate";

export interface TimedTurn {
  id: string;
  speaker: "analyst" | "expert";
  speakerName: string;
  start: number;
  end: number;
  text: string;
  flag?: "indeterminate" | "amber" | "red" | "cleared";
  flagNote?: string;
  words: readonly (readonly [string, number, number])[];
}

export interface ConditionCheck {
  label: string;
  answer: string;
  tri: KleeneVal;
}

export interface MonitorSnapshot {
  id: MonitorId;
  title: string;
  ruleSummary: string;
  terminalState: "REVIEW_REQUIRED" | "ESCALATION_REQUESTED";
  state: FsmState;
  prevState: FsmState | null;
  edgeResult: KleeneVal | null;
  guardResult: KleeneVal;
  conditions: readonly ConditionCheck[];
}

export interface FilingComparison {
  docTitle: string;
  outcome: "mismatch" | "exact_match";
  expertSummary: string;
  filedSummary: string;
}

export interface EngineSnapshot {
  at: number;
  pill: { level: "listening" | "amber" | "red" | "ended"; text: string };
  headline: string;
  summary: string;
  focusMonitor: MonitorId;
  filing: FilingComparison | null;
  monitors: Record<MonitorId, MonitorSnapshot>;
}

export const CALL_DURATION = 74;

export const CALL_MOMENTS = [
  { label: "Intro", time: 0 },
  { label: "20% drop", time: 22.48 },
  { label: "Amber warning", time: 32.48 },
  { label: "Red leak", time: 38.56 },
  { label: "Public steel", time: 61.68 },
] as const;

export const TURNS: readonly TimedTurn[] = [
  {
    id: "T1",
    speaker: "analyst",
    speakerName: "Priya Raman",
    start: 0,
    end: 7.84,
    text: "Ray, thanks for making time today. Just to confirm for our notes, you led West Coast sales at Halvorsen Pumps until mid-July, right?",
    words: [["Ray,",0,0.32],["thanks",0.35,0.56],["for",0.6,0.72],["making",0.75,0.96],["time",1.01,1.2],["today.",1.27,1.68],["Just",1.82,2.4],["to",2.43,2.48],["confirm",2.53,2.88],["for",2.92,3.04],["our",3.08,3.2],["notes,",3.27,3.92],["you",3.98,4.16],["led",4.22,4.4],["West",4.45,4.64],["Coast",4.69,4.96],["sales",5.01,5.28],["at",5.31,5.36],["Halvorsen",5.42,5.92],["Pumps",5.96,6.32],["until",6.37,6.64],["mid-July,",6.7,7.44],["right?",7.49,7.84]],
  },
  {
    id: "T2",
    speaker: "expert",
    speakerName: "Ray Castellano",
    start: 7.84,
    end: 15.04,
    text: "Yeah, that's right. Spent seven years at Halvorsen, wrapped up July fifteenth, and now I advise independent distributors.",
    words: [["Yeah,",7.84,8.64],["that's",8.66,8.8],["right.",8.83,9.04],["Spent",9.2,9.68],["seven",9.72,9.92],["years",9.96,10.16],["at",10.19,10.24],["Halvorsen,",10.3,11.2],["wrapped",11.24,11.52],["up",11.57,11.68],["July",11.73,11.92],["fifteenth,",12,12.56],["and",12.58,12.64],["now",12.72,12.96],["I",13.08,13.2],["advise",13.27,13.68],["independent",13.73,14.32],["distributors.",14.38,15.04]],
  },
  {
    id: "T3",
    speaker: "analyst",
    speakerName: "Priya Raman",
    start: 15.04,
    end: 22.48,
    text: "Great. Stepping back first, how is overall distributor demand across industrial pumps looking heading into year-end?",
    words: [["Great.",15.04,16.2],["Stepping",16.25,16.56],["back",16.61,16.8],["first,",16.88,17.68],["how",17.72,17.84],["is",17.92,18.08],["overall",18.14,18.56],["distributor",18.61,19.12],["demand",19.18,19.52],["across",19.58,19.92],["industrial",19.97,20.48],["pumps",20.53,20.8],["looking",20.85,21.2],["heading",21.24,21.52],["into",21.57,21.76],["year-end?",21.81,22.48]],
  },
  {
    id: "T4",
    speaker: "expert",
    speakerName: "Ray Castellano",
    start: 22.48,
    end: 32.48,
    flag: "indeterminate",
    flagNote: "Waiting for context",
    text: "Honestly, orders fell off a cliff in September. Channel inventories were bloated from last year, so restocking is down roughly twenty percent.",
    words: [["Honestly,",22.48,23.92],["orders",24.29,24.56],["fell",24.59,24.72],["off",24.76,24.88],["a",24.92,24.96],["cliff",25.01,25.28],["in",25.31,25.36],["September.",25.42,26.16],["Channel",26.25,26.88],["inventories",26.93,27.52],["were",27.55,27.68],["bloated",27.74,28.16],["from",28.19,28.32],["last",28.38,28.64],["year,",28.7,29.36],["so",29.47,29.68],["restocking",29.78,30.48],["is",30.51,30.56],["down",30.61,30.8],["roughly",30.84,31.12],["twenty",31.15,31.36],["percent.",31.43,32.48]],
  },
  {
    id: "T5",
    speaker: "analyst",
    speakerName: "Priya Raman",
    start: 32.48,
    end: 38.56,
    flag: "amber",
    flagNote: "Amber warning",
    text: "When you say down twenty percent, are Halvorsen's own third-quarter bookings tracking down that much right now?",
    words: [["When",32.48,32.56],["you",32.62,32.8],["say",32.84,32.96],["down",33.04,33.36],["twenty",33.39,33.6],["percent,",33.66,34.48],["are",34.52,34.64],["Halvorsen's",34.68,35.28],["own",35.36,35.6],["third-quarter",35.65,36.24],["bookings",36.3,36.8],["tracking",36.85,37.28],["down",37.34,37.6],["that",37.63,37.76],["much",37.81,38],["right",38.03,38.16],["now?",38.24,38.56]],
  },
  {
    id: "T6",
    speaker: "expert",
    speakerName: "Ray Castellano",
    start: 38.56,
    end: 52.48,
    flag: "red",
    flagNote: "Hidden from banker",
    text: "Yeah, that twenty percent is Halvorsen's West region for Q3. IT never shut off my old Salesforce pipeline login when I left, and when I checked last week, Q3 bookings were down nineteen point eight percent year over year.",
    words: [["Yeah,",38.56,39.68],["that",39.7,39.76],["twenty",39.79,40],["percent",40.05,40.4],["is",40.43,40.48],["Halvorsen's",40.52,41.04],["West",41.1,41.36],["region",41.41,41.68],["for",41.74,41.92],["Q3.",42.08,42.8],["IT",43.07,43.6],["never",43.63,43.76],["shut",43.81,44],["off",44.04,44.16],["my",44.21,44.32],["old",44.36,44.48],["Salesforce",44.53,45.04],["pipeline",45.09,45.52],["login",45.59,45.92],["when",45.94,46],["I",46.08,46.16],["left,",46.22,47.04],["and",47.06,47.12],["when",47.15,47.28],["I",47.32,47.36],["checked",47.4,47.68],["last",47.73,47.92],["week,",47.98,48.72],["Q3",48.84,49.12],["bookings",49.16,49.52],["were",49.55,49.68],["down",49.73,49.92],["nineteen",49.97,50.4],["point",50.48,50.88],["eight",50.89,50.96],["percent",51.04,51.6],["year",51.66,51.92],["over",51.97,52.16],["year.",52.22,52.48]],
  },
  {
    id: "T7",
    speaker: "analyst",
    speakerName: "Priya Raman",
    start: 52.48,
    end: 61.68,
    text: "Hold on, let's stay away from anything internal to Halvorsen. Sticking strictly to public industry data, how are steel costs affecting pump makers?",
    words: [["Hold",52.48,53.36],["on,",53.41,53.68],["let's",53.72,53.92],["stay",53.97,54.16],["away",54.19,54.32],["from",54.37,54.56],["anything",54.6,54.96],["internal",55.01,55.44],["to",55.49,55.6],["Halvorsen.",55.64,56.56],["Sticking",56.61,56.96],["strictly",57,57.36],["to",57.41,57.52],["public",57.57,57.84],["industry",57.88,58.24],["data,",58.32,59.12],["how",59.16,59.28],["are",59.32,59.44],["steel",59.49,59.76],["costs",59.85,60.32],["affecting",60.37,60.8],["pump",60.85,61.04],["makers?",61.13,61.68]],
  },
  {
    id: "T8",
    speaker: "expert",
    speakerName: "Ray Castellano",
    start: 61.68,
    end: 74,
    flag: "cleared",
    flagNote: "Verified public",
    text: "Of course, sorry about that. From the public trade press, hot-rolled steel is up around twelve percent over six months, though most manufacturers pushed through two catalog price increases this year.",
    words: [["Of",61.68,62.64],["course,",62.69,63.08],["sorry",63.1,63.2],["about",63.24,63.44],["that.",63.49,63.92],["From",64.03,64.48],["the",64.5,64.56],["public",64.61,64.88],["trade",64.93,65.2],["press,",65.27,65.92],["hot-rolled",65.98,66.4],["steel",66.48,66.88],["is",66.96,67.12],["up",67.17,67.28],["around",67.31,67.52],["twelve",67.57,67.84],["percent",67.91,68.4],["over",68.47,68.72],["six",68.78,68.96],["months,",69.02,69.92],["though",69.95,70.16],["most",70.21,70.4],["manufacturers",70.47,71.36],["pushed",71.39,71.6],["through",71.65,72],["two",72.06,72.24],["catalog",72.3,72.72],["price",72.77,73.04],["increases",73.09,73.52],["this",73.57,73.76],["year.",73.81,74]],
  },
];

const MISMATCH_FILING: FilingComparison = {
  docTitle: "Halvorsen Q2 SEC filing (reported Sep 8)",
  outcome: "mismatch",
  expertSummary: "Q3 West bookings down 19.8%",
  filedSummary: "Q2 total orders down 8.0%",
};

const PUBLIC_STEEL_FILING: FilingComparison = {
  docTitle: "Published Steel & Castings Market Note",
  outcome: "exact_match",
  expertSummary: "Hot-rolled steel up 12%",
  filedSummary: "Hot-rolled steel up 12%",
};

const baseMonitors = (recentEmployeeKnown: boolean): Record<MonitorId, MonitorSnapshot> => ({
  M1: {
    id: "M1",
    title: "Internal data",
    ruleSummary: "Flags company figures taken from internal systems or staff.",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "About Halvorsen Pumps", answer: "Not yet", tri: "indeterminate" },
      { label: "Shares a company number", answer: "Not yet", tri: "indeterminate" },
      { label: "From an internal system", answer: "Not yet", tri: "indeterminate" },
    ],
  },
  M2: {
    id: "M2",
    title: "Former login",
    ruleSummary: "Escalates if an expert uses a former employer's systems after leaving.",
    terminalState: "ESCALATION_REQUESTED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "Left Halvorsen before the call", answer: recentEmployeeKnown ? "Yes" : "Checking", tri: recentEmployeeKnown ? "true" : "indeterminate" },
      { label: "Logged into Salesforce after leaving", answer: "No", tri: "indeterminate" },
    ],
  },
  M4: {
    id: "M4",
    title: "Recent exit",
    ruleSummary: "Flags unreported numbers from anyone who left within 12 months.",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "Left Halvorsen within 12 months", answer: recentEmployeeKnown ? "Yes" : "Checking", tri: recentEmployeeKnown ? "true" : "indeterminate" },
      { label: "Shares Halvorsen's own figure", answer: "Not yet", tri: "indeterminate" },
      { label: "Unreported quarter (Q3)", answer: "Not yet", tri: "indeterminate" },
      { label: "Missing from public filings", answer: "Not yet", tri: "indeterminate" },
    ],
  },
});

export const SNAPSHOTS: readonly EngineSnapshot[] = [
  {
    at: 0,
    pill: { level: "listening", text: "Listening" },
    headline: "Listening with public filings loaded",
    summary: "Halvorsen's Q2 filing (orders down 8%) and Ray's July exit date are ready before anyone speaks.",
    focusMonitor: "M4",
    filing: null,
    monitors: baseMonitors(false),
  },
  {
    at: 12.2,
    pill: { level: "listening", text: "Listening" },
    headline: "Recent-exit rule armed",
    summary: "Ray confirmed he left Halvorsen 3 months ago, so he cannot share unreported Q3 numbers.",
    focusMonitor: "M4",
    filing: null,
    monitors: baseMonitors(true),
  },
  {
    at: 21.5,
    pill: { level: "listening", text: "Listening" },
    headline: "Broad industry question is safe",
    summary: "Priya asked about pump distributors overall, not Halvorsen specifically. The warning pill stays quiet.",
    focusMonitor: "M4",
    filing: null,
    monitors: baseMonitors(true),
  },
  {
    at: 31.2,
    pill: { level: "listening", text: "Listening" },
    headline: "20% drop noted, waiting for context",
    summary: "Ray mentioned a 20% drop without saying whether it is Halvorsen or the wider market. Blink waits instead of raising a false alarm.",
    focusMonitor: "M4",
    filing: null,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "Unclear", tri: "indeterminate" },
          { label: "Shares a company number", answer: "Yes", tri: "true" },
          { label: "From an internal system", answer: "Unclear", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "Unclear", tri: "indeterminate" },
          { label: "Unreported quarter (Q3)", answer: "Yes", tri: "true" },
          { label: "Missing from public filings", answer: "Unclear", tri: "indeterminate" },
        ],
      },
    },
  },
  {
    at: 32.48,
    pill: { level: "amber", text: "Getting close to inside information. Steer away." },
    headline: "Amber warning on Priya's question",
    summary: "Priya asked for Halvorsen's own unreported Q3 bookings. Blink warns her to steer away before Ray answers.",
    focusMonitor: "M4",
    filing: null,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "Yes", tri: "true" },
          { label: "Shares a company number", answer: "Yes", tri: "true" },
          { label: "From an internal system", answer: "Unclear", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "Yes", tri: "true" },
          { label: "Unreported quarter (Q3)", answer: "Yes", tri: "true" },
          { label: "Missing from public filings", answer: "Yes", tri: "true" },
        ],
      },
    },
  },
  {
    at: 42.1,
    pill: { level: "red", text: "Sounds like inside information. Move on." },
    headline: "Red warning: unreported Q3 figure",
    summary: "Ray confirmed the 20% drop is for Halvorsen's West region in Q3. Public filings only cover Q2 (down 8%), so the pill turns Red.",
    focusMonitor: "M4",
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NEEDS_CONTEXT",
        prevState: "UNASSESSED",
        edgeResult: "indeterminate",
        guardResult: "indeterminate",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "Yes", tri: "true" },
          { label: "Shares a company number", answer: "Yes", tri: "true" },
          { label: "From an internal system", answer: "Unclear", tri: "indeterminate" },
        ],
      },
      M2: baseMonitors(true).M2,
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "Yes", tri: "true" },
          { label: "Unreported quarter (Q3)", answer: "Yes", tri: "true" },
          { label: "Missing from public filings", answer: "Yes", tri: "true" },
        ],
      },
    },
  },
  {
    at: 45.0,
    pill: { level: "red", text: "Sounds like inside information. Move on." },
    headline: "Escalated: active Salesforce login",
    summary: "Ray admitted checking his old Halvorsen Salesforce dashboard last week (-19.8% Q3 bookings). Blink hides the quote from Priya.",
    focusMonitor: "M2",
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "Yes", tri: "true" },
          { label: "Shares a company number", answer: "Yes", tri: "true" },
          { label: "From an internal system", answer: "Yes", tri: "true" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen before the call", answer: "Yes", tri: "true" },
          { label: "Logged into Salesforce after leaving", answer: "Yes", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "Yes", tri: "true" },
          { label: "Unreported quarter (Q3)", answer: "Yes", tri: "true" },
          { label: "Missing from public filings", answer: "Yes", tri: "true" },
        ],
      },
    },
  },
  {
    at: 56.5,
    pill: { level: "listening", text: "Listening" },
    headline: "Steered back to public steel prices",
    summary: "Priya cut off the Halvorsen topic and asked about public steel costs. The Salesforce quote stays hidden for compliance.",
    focusMonitor: "M2",
    filing: MISMATCH_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "Yes", tri: "true" },
          { label: "Shares a company number", answer: "Yes", tri: "true" },
          { label: "From an internal system", answer: "Yes", tri: "true" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen before the call", answer: "Yes", tri: "true" },
          { label: "Logged into Salesforce after leaving", answer: "Yes", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "REVIEW_REQUIRED",
        prevState: "NEEDS_CONTEXT",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "Yes", tri: "true" },
          { label: "Unreported quarter (Q3)", answer: "Yes", tri: "true" },
          { label: "Missing from public filings", answer: "Yes", tri: "true" },
        ],
      },
    },
  },
  {
    at: 68.5,
    pill: { level: "ended", text: "Call ended. 1 passage hidden and sent to compliance." },
    headline: "Public steel figure cleared",
    summary: "Ray's 12% steel figure comes from trade press and matches published reports, so it is safe to use. The Salesforce quote stays hidden.",
    focusMonitor: "M1",
    filing: PUBLIC_STEEL_FILING,
    monitors: {
      M1: {
        ...baseMonitors(true).M1,
        state: "NOT_TRIGGERED",
        prevState: "UNASSESSED",
        edgeResult: "false",
        guardResult: "false",
        conditions: [
          { label: "About Halvorsen Pumps", answer: "No", tri: "false" },
          { label: "Shares a company number", answer: "No", tri: "false" },
          { label: "From an internal system", answer: "No", tri: "false" },
        ],
      },
      M2: {
        ...baseMonitors(true).M2,
        state: "ESCALATION_REQUESTED",
        prevState: "UNASSESSED",
        edgeResult: "true",
        guardResult: "true",
        conditions: [
          { label: "Left Halvorsen before the call", answer: "Yes", tri: "true" },
          { label: "Logged into Salesforce after leaving", answer: "Yes", tri: "true" },
        ],
      },
      M4: {
        ...baseMonitors(true).M4,
        state: "NOT_TRIGGERED",
        prevState: "UNASSESSED",
        edgeResult: "false",
        guardResult: "false",
        conditions: [
          { label: "Left Halvorsen within 12 months", answer: "Yes", tri: "true" },
          { label: "Shares Halvorsen's own figure", answer: "No", tri: "false" },
          { label: "Unreported quarter (Q3)", answer: "No", tri: "false" },
          { label: "Missing from public filings", answer: "No", tri: "false" },
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
