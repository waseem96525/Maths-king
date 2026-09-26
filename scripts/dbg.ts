/**
 * Scratch bench for the algebra pipeline.
 *
 * Kept as a real, type-checked module rather than a pile of `require` calls so
 * that `npm run typecheck` covers it: an untyped `require` silently degrades
 * every imported symbol to `any`, which is how a broken refactor in the system
 * solver can sit unnoticed here.
 *
 * Run with `npm run dbg`.
 */

import { MUL, NUM, SUB, VAR } from '../src/lib/math/ast';
import { normalizeMathInput } from '../src/lib/math/normalize';
import { parseEquations } from '../src/lib/math/parser';
import { toLatex, toPlain } from '../src/lib/math/latex';
import { collectLikeTerms, expand, simplify, tidy } from '../src/lib/math/simplify';
import { rat, toNumber } from '../src/lib/math/rational';
import { polyDegree, toPoly } from '../src/lib/math/poly';
import { solveLinearSystem } from '../src/lib/math/solve';

const eqs = parseEquations(normalizeMathInput('2x + y = 5, x - y = 1'));
const first = eqs[0]!;
if (first.t !== 'eq') throw new Error(`expected an equation, got ${first.t}`);
const d = tidy(SUB(first.a, first.b));
console.log('d            =', toLatex(d), '| plain:', toPlain(d));
console.log('expand(d)    =', toLatex(expand(SUB(first.a, first.b))));
console.log('simplify(d)  =', toLatex(simplify(SUB(first.a, first.b))));
console.log('collectLT(d) =', toLatex(collectLikeTerms(expand(SUB(first.a, first.b)))));

for (const v of ['x', 'y']) {
  const p = toPoly(d, v);
  console.log(`  toPoly(${v}) =`, p ? p.map((c) => `${c.n}/${c.d}`).join(',') : 'null', 'deg', p ? polyDegree(p) : '-');
}

let rest = d;
for (const [v, c] of [
  ['x', rat(2n)],
  ['y', rat(1n)],
] as const) {
  const before = toLatex(rest);
  const raw = SUB(rest, MUL(NUM(c), VAR(v)));
  console.log(`  ${before} minus ${c.n}/${c.d}*${v}:`);
  console.log(`    raw minus       : ${toLatex(raw)}`);
  console.log(`    expanded        : ${toLatex(expand(raw))}`);
  console.log(`    expanded+simp   : ${toLatex(simplify(expand(raw)))}`);
  console.log(`    collectLikeTerms: ${toLatex(collectLikeTerms(simplify(expand(raw))))}`);
  rest = tidy(raw);
  console.log(`    tidy            : ${toLatex(rest)}`);
}
const rp = toPoly(rest, '__no_var__');
console.log('rest poly =', rp ? rp.map((c) => `${c.n}/${c.d}`).join(',') : 'null', 'len', rp ? rp.length : '-');

const sys = solveLinearSystem(eqs);
console.log(
  'system =',
  sys ? sys.kind : 'null',
  sys?.solution ? Object.entries(sys.solution).map(([k, v]) => `${k}=${toNumber(v)}`).join(' ') : '',
);
if (sys) for (const st of sys.steps) console.log('  step:', st.latex);
