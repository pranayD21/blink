/**
 * SQLite via better-sqlite3 + Drizzle (decision D2). Synchronous transactions
 * are what make the release and staleness invariants simple and atomic.
 *
 * The web process and the worker process share one database file in WAL mode.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Services accept either, so they compose inside a caller's transaction. */
export type DbOrTx = Db | Tx;

interface Handle {
  db: Db;
  sqlite: Database.Database;
  path: string;
}

// Survives Next.js dev-server module reloads, so we do not leak connections.
const globals = globalThis as { __blinkDb?: Handle };

const MIGRATIONS = resolve(process.cwd(), "drizzle");

function open(path: string): Handle {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(inMemory ? ":memory:" : resolve(path));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  if (inMemory) migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, sqlite, path };
}

export function dbPath(): string {
  return process.env.BLINK_DB_PATH ?? "./data/blink.db";
}

export function getDb(): Db {
  const path = dbPath();
  if (!globals.__blinkDb || globals.__blinkDb.path !== path) {
    globals.__blinkDb?.sqlite.close();
    globals.__blinkDb = open(path);
  }
  return globals.__blinkDb.db;
}

/** A fresh, migrated in-memory database. Tests call this in `beforeEach`. */
export function resetDbForTests(): Db {
  globals.__blinkDb?.sqlite.close();
  globals.__blinkDb = open(":memory:");
  return globals.__blinkDb.db;
}

/** Applies migrations to the configured database file (used by scripts). */
export function migrateDb(): void {
  migrate(getDb(), { migrationsFolder: MIGRATIONS });
}

export function closeDb(): void {
  globals.__blinkDb?.sqlite.close();
  globals.__blinkDb = undefined;
}

/**
 * Runs `fn` in one write transaction. IMMEDIATE takes the write lock up front,
 * so two processes never deadlock upgrading from a read.
 */
export function transact<T>(fn: (tx: Tx) => T): T {
  return getDb().transaction(fn, { behavior: "immediate" });
}

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export { schema };
