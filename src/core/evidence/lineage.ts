/**
 * Turn lineage between transcript versions and claim matching on re-analysis
 * (§10.4). Pure.
 *
 * When a corrected transcript arrives, each new turn is classified as
 * same / edited / added, and each vanished old turn as removed. Claims are
 * then matched old → new by the turns they quote, so that:
 *
 *  - a claim whose quoted turns are all unchanged is carried forward as-is
 *    (same content hash, so decisions that rest on it stay valid); a second
 *    model pass over identical evidence is not allowed to rewrite it;
 *  - a claim that touches an edited, added, or removed turn gets a new
 *    version, which is what makes its dependents go stale.
 */

export interface LineageTurn {
  label: string; // "T5"
  speaker: string;
  text: string;
  textHash: string;
}

export type TurnChange = "same" | "edited" | "added" | "removed";

export interface LineageRow {
  oldLabel: string | null;
  newLabel: string | null;
  change: TurnChange;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Dice coefficient over word multisets: 1 = identical wording. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of tb) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(t, n - 1);
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

const EDIT_SIMILARITY = 0.5;

/** Aligns two turn sequences: identical turns anchor the alignment (LCS); the gaps are edits, additions, removals. */
export function diffTurns(oldTurns: readonly LineageTurn[], newTurns: readonly LineageTurn[]): LineageRow[] {
  const n = oldTurns.length;
  const m = newTurns.length;
  const same = (i: number, j: number) => oldTurns[i].textHash === newTurns[j].textHash && oldTurns[i].speaker === newTurns[j].speaker;

  // LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: LineageRow[] = [];
  const flushGap = (oldGap: number[], newGap: number[]) => {
    // Pair gap turns in order while they look like the same turn reworded.
    let a = 0;
    let b = 0;
    while (a < oldGap.length && b < newGap.length) {
      const o = oldTurns[oldGap[a]];
      const nw = newTurns[newGap[b]];
      if (o.speaker === nw.speaker && textSimilarity(o.text, nw.text) >= EDIT_SIMILARITY) {
        rows.push({ oldLabel: o.label, newLabel: nw.label, change: "edited" });
        a++;
        b++;
      } else if (oldGap.length - a > newGap.length - b) {
        rows.push({ oldLabel: o.label, newLabel: null, change: "removed" });
        a++;
      } else {
        rows.push({ oldLabel: null, newLabel: nw.label, change: "added" });
        b++;
      }
    }
    for (; a < oldGap.length; a++) rows.push({ oldLabel: oldTurns[oldGap[a]].label, newLabel: null, change: "removed" });
    for (; b < newGap.length; b++) rows.push({ oldLabel: null, newLabel: newTurns[newGap[b]].label, change: "added" });
  };

  let i = 0;
  let j = 0;
  let oldGap: number[] = [];
  let newGap: number[] = [];
  while (i < n && j < m) {
    if (same(i, j)) {
      flushGap(oldGap, newGap);
      oldGap = [];
      newGap = [];
      rows.push({ oldLabel: oldTurns[i].label, newLabel: newTurns[j].label, change: "same" });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      oldGap.push(i++);
    } else {
      newGap.push(j++);
    }
  }
  while (i < n) oldGap.push(i++);
  while (j < m) newGap.push(j++);
  flushGap(oldGap, newGap);
  return rows;
}

// ── Claim matching on re-analysis ───────────────────────────────────────────

export interface MatchQuote {
  turnLabel: string;
  start: number;
  end: number;
}

export interface MatchClaim {
  logicalKey: string;
  quotes: MatchQuote[];
}

export type ClaimPlan =
  /** Unchanged evidence: keep the existing claim row untouched. */
  | { action: "carry"; logicalKey: string; oldKey: string; newKey: string | null }
  /** Evidence changed: supersede the old claim with the new extraction, keeping the logical key. */
  | { action: "revise"; logicalKey: string; oldKey: string; newKey: string }
  /** A claim the earlier run did not have. */
  | { action: "create"; logicalKey: string; newKey: string }
  /** The quoted evidence was edited or removed and nothing in the new run replaces it. */
  | { action: "retire"; logicalKey: string; oldKey: string };

export interface ClaimMatchPlan {
  plans: ClaimPlan[];
  /** New-run key → logical key it will be stored under. */
  keyMap: Record<string, string>;
}

function nextKey(used: Set<string>): string {
  let n = used.size + 1;
  while (used.has(`C${n}`)) n++;
  const key = `C${n}`;
  used.add(key);
  return key;
}

/**
 * Plans how the claims of a new run replace the current claims.
 *
 * `lineage` maps the previous version's turns onto the new version's.
 * Old quotes are expressed in old turn labels, new quotes in new ones.
 */
export function planClaimMatch(oldClaims: readonly MatchClaim[], newClaims: readonly MatchClaim[], lineage: readonly LineageRow[]): ClaimMatchPlan {
  const oldToNew = new Map<string, { newLabel: string | null; change: TurnChange }>();
  const newChange = new Map<string, TurnChange>();
  for (const row of lineage) {
    if (row.oldLabel) oldToNew.set(row.oldLabel, { newLabel: row.newLabel, change: row.change });
    if (row.newLabel) newChange.set(row.newLabel, row.change);
  }
  const oldUntouched = (c: MatchClaim) => c.quotes.every((q) => oldToNew.get(q.turnLabel)?.change === "same");
  const newUntouched = (c: MatchClaim) => c.quotes.every((q) => newChange.get(q.turnLabel) === "same");

  // Score every (old, new) pair by the quoted text they share.
  const scores: { oldKey: string; newKey: string; score: number }[] = [];
  for (const o of oldClaims) {
    for (const nw of newClaims) {
      let score = 0;
      for (const oq of o.quotes) {
        const mapped = oldToNew.get(oq.turnLabel);
        if (!mapped?.newLabel) continue;
        for (const nq of nw.quotes) {
          if (nq.turnLabel !== mapped.newLabel) continue;
          if (mapped.change === "same") {
            const overlap = Math.min(oq.end, nq.end) - Math.max(oq.start, nq.start);
            if (overlap > 0) score += 2 + overlap / Math.max(oq.end - oq.start, nq.end - nq.start, 1);
          } else {
            score += 1; // an edited turn shifts offsets; sharing the turn is the signal
          }
        }
      }
      if (score > 0) scores.push({ oldKey: o.logicalKey, newKey: nw.logicalKey, score });
    }
  }
  scores.sort((a, b) => b.score - a.score || (a.oldKey < b.oldKey ? -1 : 1));

  const matchedOld = new Map<string, string>();
  const matchedNew = new Map<string, string>();
  for (const s of scores) {
    if (matchedOld.has(s.oldKey) || matchedNew.has(s.newKey)) continue;
    matchedOld.set(s.oldKey, s.newKey);
    matchedNew.set(s.newKey, s.oldKey);
  }

  const used = new Set(oldClaims.map((c) => c.logicalKey));
  const plans: ClaimPlan[] = [];
  const keyMap: Record<string, string> = {};
  const newByKey = new Map(newClaims.map((c) => [c.logicalKey, c]));

  for (const o of oldClaims) {
    const newKey = matchedOld.get(o.logicalKey) ?? null;
    const nw = newKey ? newByKey.get(newKey)! : null;
    if (nw) keyMap[nw.logicalKey] = o.logicalKey;
    if (oldUntouched(o) && (!nw || newUntouched(nw))) {
      plans.push({ action: "carry", logicalKey: o.logicalKey, oldKey: o.logicalKey, newKey });
    } else if (nw) {
      plans.push({ action: "revise", logicalKey: o.logicalKey, oldKey: o.logicalKey, newKey: nw.logicalKey });
    } else {
      plans.push({ action: "retire", logicalKey: o.logicalKey, oldKey: o.logicalKey });
    }
  }
  for (const nw of newClaims) {
    if (matchedNew.has(nw.logicalKey)) continue;
    const logicalKey = nextKey(used);
    keyMap[nw.logicalKey] = logicalKey;
    plans.push({ action: "create", logicalKey, newKey: nw.logicalKey });
  }
  return { plans, keyMap };
}
