import { NextResponse } from 'next/server';

import { solve, type SolveMode } from '@/lib/solver';

/**
 * The solver is a pure function, so the route is a thin adapter. It exists so
 * the browser is not the only caller: anything else (a CLI, a test, a future
 * native app) gets identical answers from identical code.
 *
 * A malformed request is a client error and returns 400 with the same shape the
 * UI already renders, so a bad input never becomes an unhandled 500.
 */

const MODES: ReadonlySet<string> = new Set(['auto', 'evaluate', 'simplify', 'differentiate', 'integrate', 'solve']);

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { input, mode, variable } = (payload ?? {}) as {
    input?: unknown;
    mode?: unknown;
    variable?: unknown;
  };

  if (typeof input !== 'string') {
    return NextResponse.json({ ok: false, error: 'Expected an `input` string.' }, { status: 400 });
  }
  if (mode !== undefined && (typeof mode !== 'string' || !MODES.has(mode))) {
    return NextResponse.json({ ok: false, error: `Unknown mode \`${String(mode)}\`.` }, { status: 400 });
  }
  if (variable !== undefined && typeof variable !== 'string') {
    return NextResponse.json({ ok: false, error: '`variable` must be a string.' }, { status: 400 });
  }

  // The engine is synchronous and total, so there is nothing to await and no
  // failure mode left to handle once the request shape is validated.
  return NextResponse.json(
    solve({ input, mode: mode as SolveMode | undefined, variable: variable as string | undefined }),
  );
}
