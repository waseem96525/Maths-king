import { NextResponse } from 'next/server';

import type { ListOptions } from '@/lib/history';
import { solve, type SolveMode } from '@/lib/solver';
import { getStore } from '@/lib/store';

/**
 * Read and write the problem history.
 *
 * Runs on the Node runtime because the repository uses `node:sqlite`, which has
 * no edge implementation.
 */
export const runtime = 'nodejs';
// History changes with every solve, so it must never be cached.
export const dynamic = 'force-dynamic';

const READ_MODES: ReadonlySet<string> = new Set(['solve', 'simplify', 'differentiate', 'integrate', 'evaluate']);
const READ_MODES_AND_AUTO: ReadonlySet<string> = new Set([...READ_MODES, 'auto']);

/** GET /api/history?search=&mode=&failures=1&limit=&offset= */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get('limit'));
  const rawOffset = Number(params.get('offset'));
  const rawMode = params.get('mode');

  if (rawMode !== null && !READ_MODES.has(rawMode)) {
    return NextResponse.json({ error: `Unknown mode \`${rawMode}\`.` }, { status: 400 });
  }
  if (params.has('limit') && (!Number.isFinite(rawLimit) || rawLimit < 1)) {
    return NextResponse.json({ error: '`limit` must be a positive number.' }, { status: 400 });
  }
  if (params.has('offset') && (!Number.isFinite(rawOffset) || rawOffset < 0)) {
    return NextResponse.json({ error: '`offset` must be zero or more.' }, { status: 400 });
  }

  const options: ListOptions = {
    search: params.get('search') ?? undefined,
    mode: (rawMode as Exclude<SolveMode, 'auto'> | null) ?? undefined,
    onlyFailures: params.get('failures') === '1',
    limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    offset: Number.isFinite(rawOffset) ? rawOffset : undefined,
  };

  const store = getStore();
  // Reading an unavailable store is not an error: it returns nothing, and the
  // reason travels with the response so the dashboard can explain itself
  // instead of rendering an empty page that looks like data loss.
  return NextResponse.json({
    available: store.available,
    reason: store.reason,
    problems: store.list(options),
    total: store.count(options),
    summary: store.summary(),
  });
}

/**
 * POST /api/history — record a solve.
 *
 * The client sends the *input*, never the answer, and the server re-solves it
 * with the same engine the page used. That keeps one source of truth for what an
 * answer is: a tampered client cannot insert arbitrary LaTeX into the history,
 * and a stored answer can never disagree with what the engine produces today.
 * It costs one extra solve, which is microseconds.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { input, mode, variable } = (payload ?? {}) as {
    input?: unknown;
    mode?: unknown;
    variable?: unknown;
  };

  if (typeof input !== 'string' || input.trim().length === 0) {
    return NextResponse.json({ error: 'Expected a non-empty `input` string.' }, { status: 400 });
  }
  if (mode !== undefined && (typeof mode !== 'string' || !READ_MODES_AND_AUTO.has(mode))) {
    return NextResponse.json({ error: `Unknown mode \`${String(mode)}\`.` }, { status: 400 });
  }
  if (variable !== undefined && typeof variable !== 'string') {
    return NextResponse.json({ error: '`variable` must be a string.' }, { status: 400 });
  }
  // The same ceiling the solver applies, so an oversized body cannot become an
  // oversized stored row.
  if (input.length > 2000) {
    return NextResponse.json({ error: 'That input is too long to record.' }, { status: 400 });
  }

  const store = getStore();
  if (!store.available) {
    return NextResponse.json({ available: false, recorded: false, reason: store.reason }, { status: 503 });
  }

  const result = solve({
    input,
    mode: mode as SolveMode | undefined,
    variable: variable as string | undefined,
  });
  const id = store.record(result);

  return NextResponse.json({ available: true, recorded: id !== null, id, mode: result.mode, ok: result.ok }, { status: 201 });
}

/** DELETE /api/history — clear the whole history. */
export async function DELETE() {
  const store = getStore();
  if (!store.available) {
    return NextResponse.json({ available: false, reason: store.reason }, { status: 503 });
  }
  return NextResponse.json({ available: true, deleted: store.clear() });
}
