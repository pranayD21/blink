// Checking a drafted summary against every hidden passage before release. Pure.
// A leak reports only what matched (a short run, a figure, a name), never more of the passage.

export interface HiddenPassage {
  label: string;
  text: string;
  numbers: number[];
  names: string[];
}

export interface Leak {
  passage: string;
  kind: "quote" | "figure" | "name";
  detail: string;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const QUOTE_RUN = 5;

/** A whole number from 0 to 100 as English words ("twenty-one"), or null outside that range. */
export function spellNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 100) return null;
  if (n === 100) return "one hundred";
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

/** Lower-cased words; punctuation, apostrophes and hyphens all separate words. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}

/** Whole numbers written with digits, ignoring decimals; thousands commas are removed ("1,200" is 1200). */
function digitNumbers(sentence: string): Set<number> {
  const found = new Set<number>();
  for (const m of sentence.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const token = m[0];
    if (/^\d{1,3}(,\d{3})+$/.test(token)) found.add(Number(token.replace(/,/g, "")));
    else if (/^\d+$/.test(token)) found.add(Number(token));
  }
  return found;
}

const TENS_WORDS = new Set(TENS.filter(Boolean));
const SMALL_WORDS = new Set(ONES.slice(1, 10));

/** True when `phrase` occurs in `list` at a position `accept` allows. */
function phraseAt(list: readonly string[], phrase: readonly string[], accept: (at: number) => boolean = () => true): boolean {
  for (let i = 0; i + phrase.length <= list.length; i++) {
    if (phrase.every((w, k) => list[i + k] === w) && accept(i)) return true;
  }
  return false;
}

function mentionsSpelled(sentenceWords: readonly string[], n: number): boolean {
  const spelled = spellNumber(n);
  if (spelled === null) return false;
  const phrase = words(spelled);
  const isTens = phrase.length === 1 && TENS_WORDS.has(phrase[0]);
  const isSmall = phrase.length === 1 && SMALL_WORDS.has(phrase[0]);
  return phraseAt(sentenceWords, phrase, (at) => {
    // "twenty" inside "twenty one" is 21, and "one" inside "twenty one" is 21; neither is a mention of 20 or 1.
    if (isTens && SMALL_WORDS.has(sentenceWords[at + 1] ?? "")) return false;
    if (isSmall && TENS_WORDS.has(sentenceWords[at - 1] ?? "")) return false;
    return true;
  });
}

/** Maximal runs of consecutive words, each at least five long, that a passage and a sentence share. */
function sharedRuns(sentenceWords: readonly string[], passageGrams: ReadonlySet<string>): string[] {
  const runs: string[] = [];
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart >= 0) runs.push(sentenceWords.slice(runStart, runEnd).join(" "));
    runStart = -1;
  };
  for (let i = 0; i + QUOTE_RUN <= sentenceWords.length; i++) {
    if (passageGrams.has(sentenceWords.slice(i, i + QUOTE_RUN).join(" "))) {
      if (runStart >= 0 && i <= runEnd - QUOTE_RUN + 1) runEnd = i + QUOTE_RUN;
      else {
        flush();
        runStart = i;
        runEnd = i + QUOTE_RUN;
      }
    }
  }
  flush();
  return runs;
}

export function findLeaks(
  sentences: readonly string[],
  hidden: readonly HiddenPassage[],
  visible: { numbers: ReadonlySet<number>; names: ReadonlySet<string> },
): Leak[] {
  const sentenceWords = sentences.map(words);
  const sentenceDigits = sentences.map(digitNumbers);
  const visibleNames = new Set([...visible.names].map((n) => words(n).join(" ")));
  const leaks: Leak[] = [];
  const seen = new Set<string>();
  const add = (passage: string, kind: Leak["kind"], detail: string) => {
    const key = `${passage}\u0000${kind}\u0000${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    leaks.push({ passage, kind, detail });
  };

  for (const p of hidden) {
    const pw = words(p.text);
    const grams = new Set<string>();
    for (let i = 0; i + QUOTE_RUN <= pw.length; i++) grams.add(pw.slice(i, i + QUOTE_RUN).join(" "));
    if (grams.size > 0) {
      for (const sw of sentenceWords) for (const run of sharedRuns(sw, grams)) add(p.label, "quote", run);
    }
    for (const n of p.numbers) {
      if (visible.numbers.has(n)) continue;
      if (sentenceWords.some((sw, i) => sentenceDigits[i].has(n) || mentionsSpelled(sw, n))) add(p.label, "figure", String(n));
    }
    for (const name of p.names) {
      const nw = words(name);
      if (nw.length === 0 || visibleNames.has(nw.join(" "))) continue;
      if (sentenceWords.some((sw) => phraseAt(sw, nw))) add(p.label, "name", name);
    }
  }
  return leaks;
}
