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
// Names with internal punctuation are not matched across spellings: "J.P. Morgan" is "j p morgan", not "jp morgan".
function words(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 0);
}

/**
 * Numbers written with digits, by value: "20.0" is 20, "20.5" is 20.5, "1,200" is 1200. A comma run that is
 * not valid thousands grouping ("20,25") is separate numbers, and a minus sign is ignored (values are absolute).
 */
function digitNumbers(sentence: string): Set<number> {
  const found = new Set<number>();
  for (const m of sentence.normalize("NFKC").matchAll(/\d+(?:[.,]\d+)*/g)) {
    const token = m[0];
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token)) {
      found.add(Number(token.replace(/,/g, "")));
      continue;
    }
    for (const part of token.split(",")) {
      if (/^\d+(\.\d+)?$/.test(part)) found.add(Number(part));
      else for (const piece of part.split(".")) found.add(Number(piece));
    }
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

/**
 * Every figure a text states, for building a passage's `numbers` and the visible set: digits by value
 * (as the leak check reads them) and whole numbers 2 to 100 spelled out. The words "zero" and "one" are
 * left out because they are mostly not figures ("the big one"); the digits 0 and 1 still count.
 */
export function numbersIn(text: string): number[] {
  const found = new Set(digitNumbers(text));
  const w = words(text);
  for (let n = 2; n <= 100; n++) if (mentionsSpelled(w, n)) found.add(n);
  return [...found];
}

const CAPITALISED = /^\p{Lu}[\p{L}\p{M}'’-]+$/u;

/**
 * Proper-name candidates: runs of two or more consecutive capitalised words ("Cardinal Utilities").
 * A one-letter word ("I", "A") breaks a run, and punctuation after a word ends it. A run that opens a
 * sentence is kept both whole and without its first word, since the opener is capitalised by grammar.
 */
export function namePhrases(text: string): string[] {
  const out: string[] = [];
  const add = (run: string[]) => {
    const phrase = run.join(" ");
    if (run.length >= 2 && !out.includes(phrase)) out.push(phrase);
  };
  let run: string[] = [];
  let runOpensSentence = false;
  let atSentenceStart = true;
  const flush = () => {
    add(run);
    if (runOpensSentence) add(run.slice(1));
    run = [];
  };
  for (const token of text.normalize("NFKC").split(/\s+/)) {
    const core = token.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
    const trailing = token.slice(token.lastIndexOf(core) + core.length);
    if (core.length > 0 && CAPITALISED.test(core)) {
      if (run.length === 0) runOpensSentence = atSentenceStart;
      run.push(core);
    } else flush();
    if (/[^\p{L}\p{N}'’]/u.test(trailing)) flush();
    if (core.length > 0 || trailing.length > 0) atSentenceStart = /[.!?]/.test(trailing);
  }
  flush();
  return out;
}

export function findLeaks(
  sentences: readonly string[],
  hidden: readonly HiddenPassage[],
  visible: { numbers: ReadonlySet<number>; names: ReadonlySet<string> },
): Leak[] {
  const visibleNumbers = new Set([...visible.numbers].map(Math.abs));
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
      const value = Math.abs(n);
      if (visibleNumbers.has(value)) continue;
      if (sentenceWords.some((sw, i) => sentenceDigits[i].has(value) || mentionsSpelled(sw, value))) add(p.label, "figure", String(n));
    }
    for (const name of p.names) {
      const nw = words(name);
      if (nw.length === 0 || visibleNames.has(nw.join(" "))) continue;
      if (sentenceWords.some((sw) => phraseAt(sw, nw))) add(p.label, "name", name);
    }
  }
  return leaks;
}
