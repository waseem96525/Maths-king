/**
 * Populate the history table with a worked set of examples.
 *
 * The rows are produced by running the real solver, not by hand-writing
 * expected answers, so the seed cannot drift away from what the engine
 * actually does. If the engine regresses, seeding fails loudly instead of
 * quietly storing a wrong answer as though it were right.
 */

import { closeDb, databaseUrl, getDb } from '../src/lib/db';
import { countProblems, recordProblem } from '../src/lib/history';
import { EXAMPLES, solve, type SolveMode } from '../src/lib/solver';

const EXTRA: ReadonlyArray<{ input: string; mode: SolveMode }> = [
  { input: 'x^2 + 2x + 1 = 0', mode: 'solve' },
  { input: '3x = 12', mode: 'solve' },
  { input: '2x + 1 > 5', mode: 'solve' },
  { input: 'x + y + z = 6, 2x - y + z = 5, x + 2y - z = 3', mode: 'solve' },
  { input: 'd/dx x^3 + 2x', mode: 'differentiate' },
  { input: 'differentiate sin(x)cos(x)', mode: 'differentiate' },
  { input: 'integrate x^2 + 2x', mode: 'integrate' },
  { input: 'integrate 1/x', mode: 'integrate' },
  { input: 'simplify (x + 2)^2', mode: 'simplify' },
  { input: 'expand (2x - 3)(x + 4)', mode: 'simplify' },
  { input: '1/2 + 1/3 + 1/6', mode: 'evaluate' },
  { input: 'sqrt(9) + 2^5', mode: 'evaluate' },
  // Kept deliberately: a recorded failure is part of the history, and it shows
  // the dashboard rendering the error state rather than only successes.
  { input: 'integrate e^(x^2)', mode: 'integrate' },
];

function main(): void {
  if (countProblems() > 0) {
    process.stdout.write('  history already has rows; run `npm run db:reset` first to start clean\n');
    closeDb();
    return;
  }

  const db = getDb();
  const all = [...EXAMPLES, ...EXTRA];
  let stored = 0;
  let failed = 0;

  for (const { input, mode } of all) {
    const result = solve({ input, mode });
    recordProblem(result, db);
    stored += 1;
    if (!result.ok) {
      failed += 1;
      process.stdout.write(`  recorded failure: ${input} -> ${result.error}\n`);
    }
  }

  process.stdout.write(`  seeded ${stored} problems into ${databaseUrl()} (${failed} of them failures)\n`);
  closeDb();
}

main();
