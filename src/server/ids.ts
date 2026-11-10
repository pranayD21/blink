/** Prefixed ULIDs (`case_01J…`). Time-ordered, so rows sort by creation. */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export function ulid(timeMs: number = Date.now()): string {
  let time = "";
  let t = Math.floor(timeMs);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let random = "";
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) random += ALPHABET[bytes[i] % 32];
  return time + random;
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
