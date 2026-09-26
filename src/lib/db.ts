/**
 * SQLite access, built on Node's own driver so there is nothing to install and
 * the app runs fully offline.
 *
 * Two rules keep this usable from both worlds:
 *
 * 1. Every import in this file is relative, because the maintenance scripts
 *    compile this module with `tsc` and run it under plain Node, where the `@/`
 *    alias does not exist.
 * 2. The connection is created lazily and cached. A route handler that opens a
 *    database per request would leak handles and defeat WAL, and creating the
 *    file at import time would break `next build`, which evaluates modules on a
 *    machine that has no business writing to the project's data directory.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Database = DatabaseSync;

const DEFAULT_PATH = 'file:./data/mathsking.db';

let cached: Database | null = null;
let cachedKey = '';

/** Read `DATABASE_URL`, defaulting to the local file from `.env.example`. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_PATH;
}

/**
 * Resolve a `file:` URL to an absolute path, leaving anything else alone.
 *
 * `file:./data/mathsking.db` is relative to the working directory, which is the
 * project root under `npm run dev` but somewhere else under some process
 * managers. Pinning it to the project root keeps the same URL meaning the same
 * file no matter who started the process.
 */
export function resolveDatabasePath(url = databaseUrl()): string {
  if (!url.startsWith('file:')) return url;
  const raw = url.slice('file:'.length);
  return resolve(process.cwd(), raw);
}

function create(url: string): Database {
  const path = resolveDatabasePath(url);
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // WAL lets a reader (a dashboard render) proceed while a writer (recording a
  // solve) commits, which matters because both happen in the same process.
  db.exec('PRAGMA journal_mode = WAL');
  // Without this SQLite would refuse to enforce the foreign keys it declares.
  db.exec('PRAGMA foreign_keys = ON');
  // Waiting rather than throwing is the right trade for a desktop-sized local
  // database: a concurrent write resolves in microseconds.
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * The shared connection, or a fresh in-memory database when url is `:memory:`.
 * An in-memory database gets its own key so tests never share state.
 */
export function getDb(url = databaseUrl()): Database {
  if (cached && cachedKey === url) return cached;
  if (cached && url === ':memory:') {
    // An in-memory database is scoped to its connection, so handing back the
    // cached file-backed handle would silently ignore the caller's request.
    return create(url);
  }
  if (!cached) {
    cached = create(url);
    cachedKey = url;
    return cached;
  }
  return cached;
}

/** Open a private database, for tests and one-off maintenance work. */
export function openDatabase(url: string): Database {
  return create(url);
}

/** Drop the cached handle. Tests use this to start from a clean slate. */
export function closeDb(): void {
  cached?.close();
  cached = null;
  cachedKey = '';
}

/**
 * Schema changes, applied in order and tracked so each runs exactly once.
 *
 * Migrations are append-only: an entry is never edited once it has shipped,
 * because a database in the field has already run it. `reset-db` is how you
 * start over, not an edit to a shipped migration.
 */
interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'problems',
    sql: `
      CREATE TABLE problems (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        input         TEXT    NOT NULL,
        mode          TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        ok            INTEGER NOT NULL,
        answer_latex  TEXT,
        answer_plain  TEXT,
        error         TEXT,
        steps_json    TEXT    NOT NULL DEFAULT '[]',
        created_at    TEXT    NOT NULL
      );
      CREATE INDEX problems_created_at_idx ON problems (created_at DESC, id DESC);
    `,
  },
];

export function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => Number((row as { id: number }).id)),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // One transaction per migration: a failure leaves the database on the last
    // version that fully applied rather than half-migrated.
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.id} (${migration.name}) failed: ${(err as Error).message}`);
    }
  }
}

/** Ids of migrations that have run, for diagnostics and the seed script. */
export function appliedMigrations(db: Database): number[] {
  return db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => Number((row as { id: number }).id));
}
