/**
 * Stored record of every problem that has been solved.
 *
 * This layer owns the SQL and the row shape; nothing above it writes a query.
 * Keeping the statements in one file means the storage format can change
 * without touching the API routes or the dashboard.
 */

import { getDb, type Database } from './db';
import type { SolveMode, SolveResult } from './solver';

/** One solved problem, as stored. */
export interface ProblemRecord {
  id: number;
  input: string;
  mode: Exclude<SolveMode, 'auto'>;
  title: string;
  ok: boolean;
  answerLatex: string | null;
  answerPlain: string | null;
  error: string | null;
  steps: { latex: string; why: string; title?: string }[];
  createdAt: string;
}

interface ProblemRow {
  id: number;
  input: string;
  mode: string;
  title: string;
  ok: number;
  answer_latex: string | null;
  answer_plain: string | null;
  error: string | null;
  steps_json: string;
  created_at: string;
}

function toRecord(row: ProblemRow): ProblemRecord {
  // steps_json is written by this file, so a parse failure means the row was
  // corrupted or hand-edited. Losing the explanation is better than losing the
  // whole answer, so the record is kept with no steps.
  let steps: ProblemRecord['steps'] = [];
  try {
    const parsed: unknown = JSON.parse(row.steps_json);
    if (Array.isArray(parsed)) steps = parsed as ProblemRecord['steps'];
  } catch {
    steps = [];
  }
  return {
    id: Number(row.id),
    input: row.input,
    mode: row.mode as Exclude<SolveMode, 'auto'>,
    title: row.title,
    ok: row.ok === 1,
    answerLatex: row.answer_latex,
    answerPlain: row.answer_plain,
    error: row.error,
    steps,
    createdAt: row.created_at,
  };
}

/**
 * Store a solve. Both outcomes are worth keeping: a failed solve is the record
 * of something the engine could not do, which is exactly what a user comes back
 * to ask about later.
 */
export function recordProblem(result: SolveResult, db: Database = getDb()): number {
  const insert = db.prepare(`
    INSERT INTO problems (input, mode, title, ok, answer_latex, answer_plain, error, steps_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = new Date().toISOString();

  if (result.ok) {
    const info = insert.run(
      result.normalized,
      result.mode,
      result.title,
      1,
      result.answerLatex,
      result.answerPlain,
      null,
      JSON.stringify(result.steps),
      createdAt,
    );
    return Number(info.lastInsertRowid);
  }

  const info = insert.run(
    result.normalized,
    result.mode,
    'Error',
    0,
    null,
    null,
    result.error,
    JSON.stringify(result.hint ? [{ latex: '', why: result.hint }] : []),
    createdAt,
  );
  return Number(info.lastInsertRowid);
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Free-text match against the input and the answer. */
  search?: string;
  mode?: Exclude<SolveMode, 'auto'>;
  onlyFailures?: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function listProblems(options: ListOptions = {}, db: Database = getDb()): ProblemRecord[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.search?.trim()) {
    // LIKE with an escaped pattern: a user searching for `x^2` should not have
    // `_` or `%` act as wildcards and match everything.
    where.push("(input LIKE ? ESCAPE '\\' OR IFNULL(answer_plain, '') LIKE ? ESCAPE '\\')");
    const pattern = `%${options.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(pattern, pattern);
  }
  if (options.mode) {
    where.push('mode = ?');
    params.push(options.mode);
  }
  if (options.onlyFailures) {
    where.push('ok = 0');
  }

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM problems ${clause}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as ProblemRow[];

  return rows.map(toRecord);
}

export function countProblems(options: Omit<ListOptions, 'limit' | 'offset'> = {}, db: Database = getDb()): number {
  const where: string[] = [];
  const params: string[] = [];
  if (options.search?.trim()) {
    where.push("(input LIKE ? ESCAPE '\\' OR IFNULL(answer_plain, '') LIKE ? ESCAPE '\\')");
    const pattern = `%${options.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(pattern, pattern);
  }
  if (options.mode) {
    where.push('mode = ?');
    params.push(options.mode);
  }
  if (options.onlyFailures) {
    where.push('ok = 0');
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(*) AS n FROM problems ${clause}`).get(...params) as { n: number };
  return Number(row.n);
}

export function getProblem(id: number, db: Database = getDb()): ProblemRecord | null {
  const row = db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as unknown as ProblemRow | undefined;
  return row ? toRecord(row) : null;
}

/** @returns whether a row was actually removed, so the route can 404 honestly. */
export function deleteProblem(id: number, db: Database = getDb()): boolean {
  return Number(db.prepare('DELETE FROM problems WHERE id = ?').run(id).changes) > 0;
}

export function clearProblems(db: Database = getDb()): number {
  return Number(db.prepare('DELETE FROM problems').run().changes);
}

/** Mode totals plus failure count, for the dashboard summary. */
export interface HistorySummary {
  total: number;
  failures: number;
  byMode: { mode: string; count: number }[];
}

export function summarise(db: Database = getDb()): HistorySummary {
  const total = db.prepare('SELECT COUNT(*) AS n FROM problems').get() as { n: number };
  const failures = db.prepare('SELECT COUNT(*) AS n FROM problems WHERE ok = 0').get() as { n: number };
  const byMode = db
    .prepare('SELECT mode, COUNT(*) AS count FROM problems GROUP BY mode ORDER BY count DESC')
    .all() as unknown as { mode: string; count: number }[];
  return { total: Number(total.n), failures: Number(failures.n), byMode };
}
