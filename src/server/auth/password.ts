/**
 * Password hashing with node:crypto's scrypt. A stored value reads
 * `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`, so the cost parameters travel with the hash and
 * can be raised later without breaking old accounts.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

const derive = (plain: string, salt: Buffer, n: number, r: number, p: number): Buffer =>
  scryptSync(plain.normalize("NFKC"), salt, KEY_BYTES, { N: n, r, p, maxmem: 128 * n * r * 2 });

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  return ["scrypt", N, R, P, salt.toString("base64"), derive(plain, salt, N, R, P).toString("base64")].join("$");
}

/** False for a wrong password, a null hash (no password login), or a stored value that is not ours. Never throws. */
export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Only parameters this module could have written: a hostile value must not make the server allocate without limit.
  if (!(n === N && r === R && p === P)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  try {
    return timingSafeEqual(derive(plain, salt, n, r, p), expected);
  } catch {
    return false;
  }
}
