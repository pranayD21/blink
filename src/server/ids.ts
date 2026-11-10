/**
 * Prefixed ULIDs (`case_01J…`). Time-ordered, so rows sort by creation.
 *
 * Ids are monotonic within a process: two ids made in the same millisecond
 * still sort in the order they were made. Several "latest row" queries break
 * ties on the id, so a random tail would make them flip under fast callers.
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const RANDOM_LENGTH = 16;

let lastTime = -1;
let lastRandom: number[] = [];

function freshRandom(): number[] {
  const bytes = randomBytes(RANDOM_LENGTH);
  const digits: number[] = [];
  for (let i = 0; i < RANDOM_LENGTH; i++) digits.push(bytes[i] % 32);
  // Leave headroom so incrementing within one millisecond cannot overflow.
  digits[0] = digits[0] % 16;
  return digits;
}

function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) {
      next[i]++;
      return next;
    }
    next[i] = 0;
  }
  return next;
}

export function ulid(timeMs: number = Date.now()): string {
  let t = Math.floor(timeMs);
  if (t <= lastTime) {
    t = lastTime;
    lastRandom = increment(lastRandom);
  } else {
    lastTime = t;
    lastRandom = freshRandom();
  }
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + lastRandom.map((d) => ALPHABET[d]).join("");
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
