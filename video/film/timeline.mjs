// One source of truth: when each line is spoken, and every cue derived from the words themselves.
import { readFileSync, writeFileSync } from "node:fs";
const N = Object.fromEntries(JSON.parse(readFileSync("src/narration.json", "utf8")).map((l) => [l.id, l]));
const at = {}; let t = 1.1;
const say = (id, gapAfter) => { at[id] = t; t += N[id].dur + gapAfter; };
const B = {};
const blink = (name, pre = 0.15, post = 0.75) => { t += pre; B[name] = t; t += 0.9 + post; };
say("l1", 0.45); say("l2", 0.8); say("l3", 0.55);
blink("b1", 0, 0.35); say("l4", 1.1);
const liveStart = t; t += 0.5; say("l5", 0.55); say("l6", 0.5);
const pillRed = t; t += 3.3;
const afterStart = t - 0.2; say("l8", 0.45);
blink("b2", 0, 0.1); const reviewStart = B.b2 + 0.42; say("l9", 0.55);
const kineticStart = t - 0.2; t += 0.15; say("l10a", 0.3); say("l10b", 0.3); say("l10c", 0.85);
const policyStart = t - 0.25; t += 0.2; say("l11", 0.5);
const briefStart = t - 0.25; t += 0.15; say("l12", 0.35);
blink("b3", 0, 0.1); const bankerStart = B.b3 + 0.42; say("l13", 0.5);
const trustStart = t - 0.25; t += 0.15; say("l14", 0.3);
blink("b4", 0, 0.25); const closeStart = B.b4 + 0.42; say("l15", 1.0);
const logo2 = t - 0.55; say("l16", 3.2);
const total = Math.ceil((t + 1.0) * 60) / 60;
const w = (id, word, nth = 0) => { const m = N[id].words.filter((x) => x.w.toLowerCase().replace(/[^a-z]/g, "") === word); if (!m[nth]) throw new Error(`no ${word} in ${id}`); return at[id] + m[nth].s; };
const cues = {
  redWords: w("l2", "suddenly"), inside: w("l2", "inside"), wall: at.l3, daysLater: w("l3", "days"),
  listens: w("l5", "listens"), everyTurn: w("l5", "every"), policy5: w("l5", "policy"),
  noTranscript: w("l6", "transcript"), noSugg: w("l6", "suggestions"), noNoise: w("l6", "noise"), onlyThis: w("l6", "only"),
  nothingLost: w("l8", "nothing"), callEnds: w("l8", "call"), reads8: w("l8", "reads"), hides: w("l8", "hides"), sends: w("l8", "sends"),
  quotes: w("l9", "exact"), rule: w("l9", "rule"), why: w("l9", "why"),
  yourRules: w("l11", "rules", 1), written: w("l11", "written"), compiled: w("l11", "compiled"), tested: w("l11", "tested"), approved: w("l11", "approved"),
  drafted: w("l12", "drafted"), cited: w("l12", "cited"), every12: w("l12", "every"),
  released: w("l13", "released"), blank: w("l13", "restricted"), hidden13: w("l13", "hidden"),
  tamper: w("l14", "tamper"), measured: w("l14", "every", 1), misses: w("l14", "even"),
  talk: at.l15, decides: w("l15", "compliance"),
};
writeFileSync("src/timeline.json", JSON.stringify({ at, B, liveStart, pillRed, afterStart, reviewStart, kineticStart, policyStart, briefStart, bankerStart, trustStart, closeStart, logo2, total, cues }, null, 1));
console.log("total", total.toFixed(1), "s; pill", pillRed.toFixed(1), "review", reviewStart.toFixed(1), "close", closeStart.toFixed(1));
