/**
 * The storage seam.
 *
 * Everything above this file talks to a `HistoryStore` and never to a driver, so
 * swapping SQLite for Postgres later means adding one implementation here
 * rather than touching the API routes or the dashboard.
 *
 * Two implementations exist today:
 *
 * - `SqliteStore` — the real one, used on a machine with a writable disk.
 * - `UnavailableStore` — used when there is nowhere to persist to. It reports
 *   that plainly instead of throwing, because a deployment with no disk should
 *   still solve maths.
 *
 * Note on the fallback: it does *not* buffer in memory. An in-memory store would
 * look like it worked while quietly losing every problem on a cold start and
 * disagreeing with itself across concurrent instances. Reporting "unavailable"
 * is the honest answer.
 */

import { getDb } from './db';
import {
  clearProblems,
  countProblems,
  deleteProblem,
  getProblem,
  listProblems,
  recordProblem,
  summarise,
  type HistorySummary,
  type ListOptions,
  type ProblemRecord,
} from './history';
import type { SolveResult } from './solver';

export interface HistoryStore {
  /** False when there is nowhere to persist to. Everything else is a no-op. */
  readonly available: boolean;
  /** Why it is unavailable, phrased for a person. Null when available. */
  readonly reason: string | null;
  /** @returns the new row id, or null when nothing was stored. */
  record(result: SolveResult): number | null;
  list(options?: ListOptions): ProblemRecord[];
  count(options?: Omit<ListOptions, 'limit' | 'offset'>): number;
  get(id: number): ProblemRecord | null;
  /** @returns whether a row was actually removed. */
  delete(id: number): boolean;
  clear(): number;
  summary(): HistorySummary;
}

class SqliteStore implements HistoryStore {
  readonly available = true;
  readonly reason = null;

  record(result: SolveResult): number {
    return recordProblem(result);
  }
  list(options: ListOptions = {}): ProblemRecord[] {
    return listProblems(options);
  }
  count(options: Omit<ListOptions, 'limit' | 'offset'> = {}): number {
    return countProblems(options);
  }
  get(id: number): ProblemRecord | null {
    return getProblem(id);
  }
  delete(id: number): boolean {
    return deleteProblem(id);
  }
  clear(): number {
    return clearProblems();
  }
  summary(): HistorySummary {
    return summarise();
  }
}

class UnavailableStore implements HistoryStore {
  readonly available = false;
  constructor(readonly reason: string) {}

  record(): number | null {
    return null;
  }
  list(): ProblemRecord[] {
    return [];
  }
  count(): number {
    return 0;
  }
  get(): ProblemRecord | null {
    return null;
  }
  delete(): boolean {
    return false;
  }
  clear(): number {
    return 0;
  }
  summary(): HistorySummary {
    return { total: 0, failures: 0, byMode: [] };
  }
}

/** Errors that mean "this filesystem will not cooperate", as opposed to a bug. */
const FILESYSTEM_CODES = new Set(['EROFS', 'EACCES', 'EPERM', 'ENOSPC']);

export function createStore(): HistoryStore {
  // Vercel is checked first: its filesystem is read-only apart from an ephemeral
  // /tmp, so there is no point provoking an EROFS and logging a stack trace on
  // every cold start.
  if (process.env.VERCEL) {
    return new UnavailableStore(
      'This deployment has no writable disk, so problem history is switched off. The solver itself is unaffected.',
    );
  }

  try {
    getDb();
    return new SqliteStore();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !FILESYSTEM_CODES.has(code)) {
      // Not a filesystem problem, so this is a real fault. Rethrowing keeps a
      // genuine bug from hiding behind a friendly "history unavailable".
      throw err;
    }
    return new UnavailableStore(
      `The problem history database could not be opened (${code}). The solver itself is unaffected.`,
    );
  }
}

let store: HistoryStore | null = null;

/** The store for this process, decided once. */
export function getStore(): HistoryStore {
  store ??= createStore();
  return store;
}

/** Replace the process-wide store. Tests use this; nothing else should. */
export function setStore(next: HistoryStore | null): void {
  store = next;
}
