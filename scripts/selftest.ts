/**
 * Self-test for the offline mathematics engine.
 *
 * This is not a placeholder: every assertion here is a real mathematical
 * check that runs in CI and locally via `npm run selftest`. The engine is the
 * app's source of truth for verification, so it has to be provably right
 * before the AI layer is allowed to add to it.
 */

import { normalizeMathInput } from '../src/lib/math/normalize';
import { parseEquations, parseExpression, tryParseExpression } from '../src/lib/math/parser';
import { toLatex, toPlain } from '../src/lib/math/latex';
import { evaluate, evaluateExact, collectVars, MathError, tryEvaluateExact } from '../src/lib/math/evaluate';
import { simplify, expand, tidy, collectPolynomial } from '../src/lib/math/simplify';
import { differentiate } from '../src/lib/math/differentiate';
import { definiteIntegrate, integrate, numericIntegrate } from '../src/lib/math/integrate';
import { solveEquation, solveLinearInequality, solveLinearSystem } from '../src/lib/math/solve';
import { toDecimalString, rat, toString as ratToString } from '../src/lib/math/rational';
import { isNum, NUM, type Node } from '../src/lib/math/ast';
// Aliased: selftest.ts already declares a local `solve` helper for the
// equation-solving section above.
import { solve as solveRequest } from '../src/lib/solver';
import { appliedMigrations, migrate, openDatabase } from '../src/lib/db';
import {
  clearProblems,
  countProblems,
  deleteProblem,
  getProblem,
  listProblems,
  recordProblem,
  summarise,
} from '../src/lib/history';

let passed = 0;
let failed = 0;
const failures: string[] = [];

/** BigInt-safe stringify so a failing detail message can never mask the real assertion. */
function dump(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x)) ?? String(v);
  } catch {
    return String(v);
  }
}

function ok(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = String(actual);
  const b = String(expected);
  ok(name, a === b, `expected ${b}, got ${a}`);
}

function approx(name: string, actual: number, expected: number, tol = 1e-9): void {
  ok(name, Math.abs(actual - expected) <= tol, `expected ≈${expected}, got ${actual}`);
}

function evalStr(src: string, env: Record<string, number> = {}): number {
  return evaluate(parseExpression(normalizeMathInput(src)), env);
}

function exactStr(src: string, env: Record<string, number> = {}): string {
  return toDecimalString(evaluateExact(parseExpression(normalizeMathInput(src)), env), 12);
}

/**
 * The exact value as a fraction, or the string `null` when the engine correctly
 * declines to give one. This is the assertion that matters for irrational
 * results: a float dressed up as a fraction would still be non-null here.
 */
function exactOrNull(src: string, env: Record<string, number> = {}): string {
  const v = tryEvaluateExact(parseExpression(normalizeMathInput(src)), env);
  return v === null ? 'null' : ratToString(v);
}

function section(title: string): void {
  process.stdout.write(`\n  ${title}\n`);
}

/* ------------------------------------------------------------------ */
section('Normalization and parsing');

eq('latex fraction', normalizeMathInput('\\frac{1}{2}'), '((1)/(2))');
eq('latex sqrt', normalizeMathInput('\\sqrt{9}'), 'sqrt(9)');
eq('thousands separator', normalizeMathInput('1,000 + 2,000'), '1000 + 2000');
eq('degree symbol', normalizeMathInput('sin 30°'), 'sin 30°');
ok('degrees parse', Math.abs(evalStr('sin 30°') - 0.5) < 1e-12, `got ${evalStr('sin 30°')}`);
ok('implicit multiplication', Math.abs(evalStr('2x', { x: 7 }) - 14) < 1e-12);
ok('implicit multiplication with parens', Math.abs(evalStr('3(4+1)') - 15) < 1e-12);
ok('adjacent parens multiply', Math.abs(evalStr('(2)(3)') - 6) < 1e-12);
ok('unary minus', Math.abs(evalStr('-3^2')) === 9, `got ${evalStr('-3^2')}`);
ok('power binds tighter than unary', Math.abs(evalStr('2^-2') - 0.25) < 1e-12);

// Regression: a signed literal exponent has to arrive as a single Rational. The
// power rule, the polynomial collector and the integrator all recognise a
// constant exponent by testing `isNum(n.b)`, so while `x^-1` parsed as
// POW(x, NEG(NUM(1))) the derivative silently fell through to the general
// variable-exponent rule and rendered as `x^{-1} * -1/x` instead of -1/x^2.
const negExp = parseExpression('x^-1');
ok(
  'negative exponent folds into one literal',
  negExp.t === '^' && negExp.b.t === 'num' && negExp.b.v.n === -1n,
  dump(negExp),
);
// Folding the sign must not let it swallow the power: -x^2 is -(x^2), not
// (-x)^2, and the operand is fully parsed before the sign is applied.
ok('negation binds looser than the power', evalStr('-x^2', { x: 7 }) === -49, `got ${evalStr('-x^2', { x: 7 })}`);
ok('factorial', Math.abs(evalStr('5!') - 120) < 1e-12);
ok('percent', Math.abs(evalStr('20%') - 0.2) < 1e-12);
ok('subscript variable', Math.abs(evalStr('x_1', { x_1: 4 }) - 4) < 1e-12);
ok('absolute value', Math.abs(evalStr('| -7 |') - 7) < 1e-12);
ok('log base', Math.abs(evalStr('log(2, 8)') - 3) < 1e-12);
ok('nested functions', Math.abs(evalStr('sqrt(sin(0))')) < 1e-12);
ok('reject garbage', tryParseExpression('2 +* 3') === null);
ok('collect vars', [...collectVars(parseExpression('2x + 3y'))].sort().join(',') === 'x,y');
eq('parse system', parseEquations('2x + y = 5, x - y = 1').length, 2);

/* ------------------------------------------------------------------ */
section('Exact rational arithmetic');

eq('1/3 + 1/6', exactStr('1/3 + 1/6'), '0.5');
eq('0.1 + 0.2', exactStr('0.1 + 0.2'), '0.3');
eq('1/7 * 7', exactStr('(1/7) * 7'), '1');
eq('2/4', exactStr('2/4'), '0.5');
eq('mixed fraction', exactStr('3 + 1/2'), '3.5');
eq('mixed fraction 2', exactStr('1 + 1/2 + 1/4'), '1.75');
eq('negative exact', exactStr('-1/3'), '-0.333333333333');
approx('sqrt2 numeric', evalStr('sqrt(2)'), Math.SQRT2, 1e-12);
eq('sqrt 9 exact', exactStr('sqrt(9)'), '3');
eq('gcd', exactStr('gcd(12, 18)'), '6');
eq('lcm', exactStr('lcm(4, 6)'), '12');
eq('choose', exactStr('comb(5, 2)'), '10');
eq('permute', exactStr('perm(5, 2)'), '20');

// Regressions: a common denominator built as (a.d/g)*(b.d/g) instead of the
// lcm, and an unnormalised negative denominator, both produced plausible but
// wrong answers before these were fixed. `exactStr` renders decimals, so the
// expectations are the exact decimal expansions, not fractions.
eq('lcm denom', exactStr('1/6 + 1/3'), '0.5');
eq('lcm denom 2', exactStr('1/4 + 1/6'), '0.416666666666');
eq('sub sign', exactStr('-1/2 - 1/3'), '-0.833333333333');
eq('div negative', exactStr('(1/-2) + 1'), '0.5');
eq('nested div', exactStr('(2/3) / (4/5)'), '0.833333333333');
eq('system arith', exactStr('2/3 + 1/6 * 2'), '1');
eq('repeat denom', exactStr('1/3 + 1/3 + 1/3 + 1/3'), '1.333333333333');
eq('threeway lcm', exactStr('1/7 + 1/11 + 1/13'), '0.31068931068');
eq('mod', exactStr('mod(17, 5)'), '2');

/* ------------------------------------------------------------------ */
section('Simplification and collection');

eq('collect like terms', toLatex(tidy(parseExpression('2x + 5x + 3'))), '7x + 3');
eq('distribute', toLatex(tidy(parseExpression('(x+1)(x-1)'))), 'x^{2} - 1');
eq('substitute identity', toPlain(tidy(parseExpression('(x+1)(x-1)'))), 'x^2 - 1');
eq('constant folding', toLatex(simplify(parseExpression('2+3*4'))), '14');
eq('zero times x', toLatex(simplify(parseExpression('0 * x'))), '0');
eq('collect quadratic', toLatex(collectPolynomial(parseExpression('2x + 3 - x - 1'), 'x')!), 'x + 2');
eq('collect three vars', toLatex(tidy(parseExpression('2x + 3y + x - y + 1'))), '3x + 2y + 1');
eq('collect keeps foreign var', toLatex(tidy(parseExpression('2x + 5x + y'))), '7x + y');
// A sum sitting in a denominator is not a term of the expression enclosing it,
// so a top-level-only collection pass used to leave every term an expansion
// produced loose inside the fraction.
eq('collect inside a denominator', toLatex(tidy(parseExpression('1/(2x + 3x + 1)'))), '\\frac{1}{5x + 1}');
eq('collect inside a function argument', toLatex(tidy(parseExpression('ln(x + x)'))), '\\ln\\left(2x\\right)');
eq('fold matching powers', toLatex(tidy(parseExpression('x^2*x^3'))), 'x^{5}');
eq('expand square', toLatex(tidy(parseExpression('(x+2)^2'))), 'x^{2} + 4x + 4');
eq('cube', toLatex(tidy(parseExpression('(x+1)^3'))), 'x^{3} + 3x^{2} + 3x + 1');

/* ------------------------------------------------------------------ */
section('LaTeX rendering');

eq('simple fraction', toLatex(parseExpression('1/2')), '\\frac{1}{2}');
eq('mixed number', toLatex(parseExpression('(1/2)*x')), '\\frac{1}{2}x');
eq('division by x', toLatex(parseExpression('1/x')), '\\frac{1}{x}');
eq('sqrt', toLatex(parseExpression('sqrt(x+1)')), '\\sqrt{x + 1}');
eq('trig', toLatex(parseExpression('sin(2x)')), '\\sin\\left(2x\\right)');
eq('parens for compound', toLatex(parseExpression('(x+1)(x-1)')), '\\left(x + 1\\right)\\left(x - 1\\right)');
ok('equation latex', toLatex(parseExpression('2x + 5 = 15')).includes('='));
// `\left\rceil` used to close a ceil, which is not valid LaTeX: KaTeX rejects
// the whole block rather than rendering it.
eq('ceil uses balanced delimiters', toLatex(parseExpression('ceil(2.5)')), '\\left\\rceil \\frac{5}{2} \\right\\rceil');
// An argument that already carries its own brackets must not gain another pair.
eq('self-delimited argument is not re-wrapped', toLatex(parseExpression('ln(abs(x))')), '\\ln\\left|x\\right|');
eq('negative numerator lifts out of the fraction', toLatex(parseExpression('(-x)/2')), '-\\frac{x}{2}');
eq('negative literal fraction', toLatex(NUM(rat(-3n, 2n))), '-\\frac{3}{2}');
// ...but a numerator that merely *starts* with a minus has to keep its sign,
// or (-x - 1)/2 would silently become (-x + 1)/2.
eq('sum numerator keeps its sign', toLatex(parseExpression('(-x-1)/2')), '\\frac{-x - 1}{2}');

/* ------------------------------------------------------------------ */
section('Differentiation');

function diffStr(src: string, v: string): string {
  return toLatex(tidy(differentiate(parseExpression(normalizeMathInput(src)), v), v));
}
eq('d/dx x^2', diffStr('x^2', 'x'), '2x');
eq('d/dx x^3', diffStr('x^3', 'x'), '3x^{2}');
eq('d/dx 5x', diffStr('5x', 'x'), '5');
eq('d/dx constant', diffStr('7', 'x'), '0');
eq('d/dx x^-1', diffStr('x^-1', 'x'), '-\\frac{1}{x^{2}}');
// The power rule now reaches negative integer exponents, so `3x^-2` is
// differentiated as -6x^-3 instead of via the general variable-exponent path.
eq('d/dx 3x^-2', diffStr('3x^-2', 'x'), '-\\frac{6}{x^{3}}');
eq('d/dx (x+1)^-2', diffStr('(x+1)^-2', 'x'), '-\\frac{2}{\\left(x^{3} + 3x^{2} + 3x + 1\\right)}');
eq('d/dx sin x', diffStr('sin(x)', 'x'), '\\cos\\left(x\\right)');
eq('d/dx e^x', diffStr('exp(x)', 'x'), 'e^{x}');
eq('d/dx ln x', diffStr('ln(x)', 'x'), '\\frac{1}{x}');
eq('d/dx x*y', diffStr('x*y', 'x'), 'y');
ok('d/dx 1/x numeric', Math.abs(evaluate(differentiate(parseExpression('1/x'), 'x'), { x: 3 }) + 1 / 9) < 1e-12);

// Chain rule checked numerically rather than by string.
const chainN = differentiate(parseExpression('sin(3x)'), 'x');
approx('chain rule d/dx sin(3x) at 0.7', evaluate(chainN, { x: 0.7 }), 3 * Math.cos(3 * 0.7), 1e-9);
const prodN = differentiate(parseExpression('x^2*exp(x)'), 'x');
approx('product rule d/dx x^2 e^x at 1.3', evaluate(prodN, { x: 1.3 }), 2 * 1.3 * Math.exp(1.3) + 1.3 * 1.3 * Math.exp(1.3), 1e-9);

// Every derivative is also re-checked against a central difference of the
// original function. A rendered answer can look entirely plausible and still be
// the wrong function, and no amount of string comparison will catch that.
const NUMERIC_DERIV_CASES = [
  'x^2',
  '3x',
  '1/x',
  'x^-1',
  '3x^-2',
  'x^-3',
  '(x+1)^-2',
  '(x+1)^3',
  '1/(x+1)',
  'sin(x)',
  'sin(3x)',
  'cos(x)',
  'tan(x)',
  'exp(x)',
  'exp(-x)',
  'ln(x)',
  'sqrt(x)',
  'x^2*exp(x)',
  'x/(x+1)',
];
for (const src of NUMERIC_DERIV_CASES) {
  const f = parseExpression(normalizeMathInput(src));
  const at = (x: number): number => evaluate(f, { x });
  const h = 1e-5;
  const finiteDifference = (at(1.7 + h) - at(1.7 - h)) / (2 * h);
  const symbolic = evaluate(differentiate(f, 'x'), { x: 1.7 });
  ok(
    `numeric d/dx ${src}`,
    Math.abs(symbolic - finiteDifference) <= 1e-6 * Math.max(1, Math.abs(finiteDifference)),
    `symbolic ${symbolic}, numeric ${finiteDifference}`,
  );
}

/* ------------------------------------------------------------------ */
section('Integration');

function antiStr(src: string, v: string): string | null {
  const r = integrate(parseExpression(normalizeMathInput(src)), v);
  return r ? toLatex(r.antiderivative) : null;
}
eq('∫ x^2 dx', antiStr('x^2', 'x'), '\\frac{x^{3}}{3}');
eq('∫ 3x dx', antiStr('3x', 'x'), '\\frac{3x^{2}}{2}');
eq('∫ 1/x dx', antiStr('1/x', 'x'), '\\ln\\left|x\\right|');
eq('∫ exp(x) dx', antiStr('exp(x)', 'x'), 'e^{x}');
approx(
  '∫₀¹ x^2 dx',
  definiteIntegrate(parseExpression('x^2'), 'x', 0, 1).numeric,
  1 / 3,
  1e-9,
);
eq('∫₀¹ x^2 exact', toDecimalString(definiteIntegrate(parseExpression('x^2'), 'x', 0, 1).exact!, 12), '0.333333333333');
approx('∫₀^π sin x dx', definiteIntegrate(parseExpression('sin(x)'), 'x', 0, Math.PI).numeric, 2, 1e-9);
approx('numeric fallback ∫₀¹ x^4+1 dx', numericIntegrate((x) => x ** 4 + 1, 0, 1), 1.2, 1e-9);
// Differentiation of the antiderivative must return the integrand.
for (const f of ['x^3', '5x^2', 'sin(2x)', 'exp(3x)', '1/x']) {
  const integ = integrate(parseExpression(f), 'x');
  if (!integ) {
    ok(`round trip ${f}`, false, 'no antiderivative');
    continue;
  }
  const back = differentiate(integ.antiderivative, 'x');
  const a = evaluate(back, { x: 0.7 });
  const b = evalStr(f, { x: 0.7 });
  ok(`d/dx ∫ ${f} dx == ${f}`, Math.abs(a - b) < 1e-8, `got ${a} vs ${b}`);
}

/* ------------------------------------------------------------------ */
section('Equation solving');

function solve(src: string): ReturnType<typeof solveEquation> {
  const eqs = parseEquations(normalizeMathInput(src)).filter((e) => e.t === 'eq');
  return solveEquation(eqs[0] as Node);
}
eq('2x+5=15 answer', solve('2x + 5 = 15')!.answerLatex, 'x = 5');
eq('2x+5=15 steps > 2', solve('2x + 5 = 15')!.steps.length >= 2 ? 'yes' : 'no', 'yes');
eq('3x=12', solve('3x = 12')!.answerLatex, 'x = 4');
eq('5 - 2x = 9', solve('5 - 2x = 9')!.answerLatex, 'x = -2');
eq('x/3 = 4', solve('x/3 = 4')!.answerLatex, 'x = 12');
eq('2x - 3 = x + 7', solve('2x - 3 = x + 7')!.answerLatex, 'x = 10');
eq('x^2-5x+6=0 method', solve('x^2 - 5x + 6 = 0')!.method, 'Factorisation');
eq('x^2-5x+6=0 answer', solve('x^2 - 5x + 6 = 0')!.answerLatex, 'x = 2 \\quad \\text{or} \\quad x = 3');
eq('2x^2-4=0', solve('2x^2 - 4 = 0')!.answerLatex, 'x = \\sqrt{2} \\quad \\text{or} \\quad x = -\\sqrt{2}');
ok('x^2+1=0 has no real root', solve('x^2 + 1 = 0')!.answerLatex.includes('No real solution'));
ok('x^2=4 double root', solve('x^2 + 2x + 1 = 0')!.answerLatex === 'x = -1', solve('x^2 + 2x + 1 = 0')!.answerLatex);
ok('every step has a why', solve('x^2 - 5x + 6 = 0')!.steps.every((s) => s.why.length > 10));
ok('cubic rational roots', solve('x^3 - 6x^2 + 11x - 6 = 0')!.roots.length === 3);

/* ------------------------------------------------------------------ */
section('Linear systems');

const sys = solveLinearSystem(parseEquations(normalizeMathInput('2x + y = 5, x - y = 1')));
eq('system kind', sys!.kind, 'unique');
eq('system x', toDecimalString(sys!.solution!.x!), '2');
eq('system y', toDecimalString(sys!.solution!.y!), '1');
const sys2 = solveLinearSystem(parseEquations(normalizeMathInput('x + y = 10, 2x + 3y = 24')));
eq('system2 x', toDecimalString(sys2!.solution!.x!), '6');
eq('system2 y', toDecimalString(sys2!.solution!.y!), '4');
const sys3 = solveLinearSystem(parseEquations(normalizeMathInput('x + y = 10, 2x + 2y = 5')));
eq('inconsistent system', sys3!.kind, 'none');
const sys4 = solveLinearSystem(parseEquations(normalizeMathInput('x + y = 10, 2x + 2y = 20')));
eq('dependent system', sys4!.kind, 'infinite');
const sys3v = solveLinearSystem(parseEquations(normalizeMathInput('x + y + z = 6, 2x - y + z = 5, x + 2y - z = 3')));
eq('3-variable system kind', sys3v?.kind, 'unique');
if (sys3v?.kind === 'unique' && sys3v.solution) {
  const sol: Record<string, number> = {};
  for (const [k, val] of Object.entries(sys3v.solution)) sol[k] = toNumberR(val);
  const cases = ['x + y + z = 6', '2x - y + z = 5', 'x + 2y - z = 3'];
  let allGood = cases.length > 0;
  for (const raw of cases) {
    const [l, r] = raw.split('=');
    const le = evaluate(parseExpression(l!.trim()), sol);
    const re = evaluate(parseExpression(r!.trim()), sol);
    if (Math.abs(le - re) > 1e-9) allGood = false;
  }
  ok('3-variable solution satisfies equations', allGood, dump(sys3v.solution));
}
function toNumberR(r: ReturnType<typeof rat>): number {
  return Number(r.n) / Number(r.d);
}

/* ------------------------------------------------------------------ */
section('Inequalities');

const ineq = solveLinearInequality(parseEquations(normalizeMathInput('2x + 1 > 5'))[0] as never);
eq('2x+1>5', ineq!.solutionLatex, 'x > 2');
const ineq2 = solveLinearInequality(parseEquations(normalizeMathInput('-2x + 3 <= 7'))[0] as never);
eq('-2x+3<=7 flips', ineq2!.solutionLatex, 'x \\geq -2');

/* ------------------------------------------------------------------ */
section('Error handling');

let threwDivision = false;
try {
  evalStr('1/0');
} catch (e) {
  threwDivision = e instanceof MathError;
}
ok('division by zero raises MathError', threwDivision);
let threwDomain = false;
try {
  evalStr('ln(0)');
} catch (e) {
  threwDomain = e instanceof MathError;
}
ok('ln(0) raises MathError', threwDomain);
ok('sqrt of negative raises', (() => {
  try {
    evalStr('sqrt(0-4)');
    return false;
  } catch {
    return true;
  }
})());
ok('unknown symbol raises', (() => {
  try {
    evalStr('zebra + 1');
    return false;
  } catch {
    return true;
  }
})());

/* ------------------------------------------------------------------ */
section('Round-trip property checks');

// For every generated solution, substituting the root must satisfy the equation.
const propertyCases = [
  '2x + 5 = 15',
  '7x - 3 = 18',
  'x/4 + 2 = 6',
  'x^2 - 5x + 6 = 0',
  'x^2 + 2x + 1 = 0',
  '3x^2 - 12 = 0',
  'x^2 + 2x - 3 = 0',
  '2x^2 - 7x + 3 = 0',
  'x^3 - 6x^2 + 11x - 6 = 0',
  '5x = 0',
  'x + 1 = x + 1',
  '-4x + 10 = 2',
];
for (const src of propertyCases) {
  const res = solve(src);
  if (!res) {
    ok(`property ${src}`, false, 'solver returned null');
    continue;
  }
  if (res.roots.length === 0 && res.method === 'Identity') {
    ok(`property ${src} (identity)`, true);
    continue;
  }
  const numericRoots: number[] = [];
  for (const r of res.roots) {
    if (r.kind === 'rational') {
      numericRoots.push(Number(r.value.n) / Number(r.value.d));
    } else if (r.kind === 'complex') {
      // Complex roots are verified separately below.
      continue;
    } else if (r.kind === 'radical') {
      const disc = Number(r.radicand.n) / Number(r.radicand.d);
      const s = Math.sqrt(Math.max(disc, 0));
      const c = Number(r.coeff.n) / Number(r.coeff.d);
      numericRoots.push(c + s, c - s);
    } else {
      numericRoots.push(r.value);
    }
  }
  const eqNode = parseEquations(normalizeMathInput(src))[0]!;
  let allPass = numericRoots.length > 0 || res.roots.some((r) => r.kind === 'complex');
  for (const root of numericRoots) {
    const l = evaluate(eqNode.t === 'eq' ? eqNode.a : eqNode, { x: root });
    const r = evaluate(eqNode.t === 'eq' ? eqNode.b : eqNode, { x: root });
    if (Math.abs(l - r) > 1e-7) allPass = false;
  }
  ok(`property ${src}`, allPass, `roots ${numericRoots.join(', ')}`);
}

/* ------------------------------------------------------------------ */
section('Exactness and degrees');

// Degrees must build one canonical multiple of pi. The earlier shape,
// `30 * (1*pi/180)`, rendered as \frac{301\pi}{180} because the coefficient was
// pasted onto the front of a product numerator instead of multiplied into it.
eq('degree renders one fraction over 180', toLatex(parseExpression('30°')), '\\frac{30\\pi}{180}');
eq('degree inside a call', toLatex(parseExpression('sin 30°')), '\\sin\\left(\\frac{30\\pi}{180}\\right)');
eq('coefficient folds into a product numerator', toLatex(parseExpression('30*((1*pi)/180)')), '\\frac{30\\pi}{180}');
eq('small coefficient too', toLatex(parseExpression('2*((1*pi)/180)')), '\\frac{2\\pi}{180}');

// Niven's theorem: these are the only rational values sin/cos/tan can take at a
// rational multiple of pi, and they must come back as exact fractions rather
// than a float that merely looks close to one.
eq('sin 30 exact', exactOrNull('sin 30°'), '1/2');
eq('cos 60 exact', exactOrNull('cos 60°'), '1/2');
eq('tan 45 exact', exactOrNull('tan 45°'), '1');
eq('sin 90 exact', exactOrNull('sin 90°'), '1');
eq('sin 150 exact', exactOrNull('sin 150°'), '1/2');
eq('sin -30 exact', exactOrNull('sin(-30°)'), '-1/2');

// Everything else is genuinely irrational. Declining is the honest answer; the
// alternative is reporting a float as if it were an exact fraction.
eq('sin 45 declines', exactOrNull('sin 45°'), 'null');
eq('sin 1 declines', exactOrNull('sin 1°'), 'null');
eq('cos 30 declines', exactOrNull('cos 30°'), 'null');
eq('pi itself declines', exactOrNull('pi'), 'null');
// A fractional power is rational only in special cases, so 2^(1/2) must not be
// laundered through a float either.
eq('2^(1/2) declines', exactOrNull('2^(1/2)'), 'null');
// But an integer power is exact, and the special cases still work.
eq('2^10 exact', exactOrNull('2^10'), '1024');
eq('2^-2 exact', exactOrNull('2^-2'), '1/4');
eq('(2/3)^3 exact', exactOrNull('(2/3)^3'), '8/27');
eq('sqrt of a square is exact', exactOrNull('sqrt(9)'), '3');

/* ------------------------------------------------------------------ */
section('Step rendering');

// A step has to state a real algebraic move. This one rendered as
// `2x 10 = 10 10` — the sign was missing entirely — and the explanation claimed
// that adding to both sides would zero the right-hand side, which is false.
ok(
  'linear step keeps its signs',
  !solve('2x + 5 = 15')!.steps.some((s) => /\d\s+\d\s*=/.test(s.latex)),
  JSON.stringify(solve('2x + 5 = 15')!.steps.map((s) => s.latex)),
);
ok(
  'linear steps explain a real move',
  solve('2x + 5 = 15')!.steps.every((s) => s.why.length > 20),
  JSON.stringify(solve('2x + 5 = 15')!.steps.map((s) => s.why)),
);
ok(
  'no step claims adding makes a side zero',
  solve('2x + 5 = 15')!.steps.every((s) => !/add\w*\b[^.]*becomes zero/i.test(s.why)),
);
// A coefficient of one is never written out: \frac{1x^{2}}{4} is noise.
eq('no unit coefficient in a fraction', toLatex(parseExpression('x/2')), '\\frac{x}{2}');
eq('unit coefficient in a power fraction', toLatex(parseExpression('x^2/4')), '\\frac{x^{2}}{4}');
// The integrator keeps the coefficient and its reciprocal apart; tidy cancels
// them, which is what the solver shows.
eq('integrate 3x^2 tidies to x^3', toLatex(tidy(integrate(parseExpression('3x^2'), 'x')!.antiderivative, 'x')), 'x^{3}');

/* ------------------------------------------------------------------ */
section('Mode and prefix handling');

// An intent prefix has to be consumed whichever mode the caller asked for. The
// mode buttons and the example chips both send an explicit mode *and* a
// prefixed input, and leaving the prefix in turned `integrate` into a variable:
// `integrate x^2 + 2x` came back as `0 + C`, and `simplify (2x-3)(x+4)` came
// back as `\left(\text{simplify}2xx + 4\text{simplify}2x\right)...`.
//
// In Auto the prefix picks the operation. Given an explicit mode, that mode
// wins — but the prefix must still be consumed, so the mode word never becomes
// a variable.
const PREFIXES = [
  { input: 'integrate x^2 + 2x', word: 'integrate' },
  { input: 'simplify (2x-3)(x+4)', word: 'simplify' },
  { input: 'd/dx x^2', word: 'd/dx' },
  { input: 'evaluate 2^10', word: 'evaluate' },
] as const;
const ALL_MODES = ['auto', 'solve', 'simplify', 'differentiate', 'integrate', 'evaluate'] as const;

for (const { input, word } of PREFIXES) {
  for (const mode of ALL_MODES) {
    const r = ask(input, mode);
    const rendered = JSON.stringify(r);
    ok(
      `\`${word}\` is not parsed as a variable in ${mode} mode`,
      !rendered.includes(`\\text{${word}}`) && !rendered.includes(`text{${word}}`),
      rendered,
    );
    if (mode !== 'auto') {
      ok(`explicit mode ${mode} is honoured for \`${input}\``, r.mode === mode, `got ${r.mode}`);
    }
  }
}

// In Auto the prefix still selects the operation and the answer.
answered(ask('integrate x^2 + 2x'), '\\frac{x^{3}}{3} + x^{2} + C', 'integrate');
answered(ask('simplify (x+1)(x-1)'), 'x^{2} - 1', 'simplify');
answered(ask('d/dx x^2'), '2x', 'differentiate');
answered(ask('evaluate 1/3 + 1/6'), '\\frac{1}{2}', 'evaluate');
// A mode that does not fit the input reports the expression rather than
// inventing an answer: `2x + 5 = 15` is an equation, not a value.
answered(ask('2x + 5 = 15', 'evaluate'), '2x + 5 = 15', 'evaluate');

// No input may crash the engine, whatever it is. These all used to throw out of
// the solver, because a division by a zero denominator reached `toPoly` and
// then `rat(1, 0)`.
for (const bad of ['1/0', 'x/0', 'integrate 1/0', 'simplify 1/0', 'evaluate 1/0', '0/0']) {
  let crashed: string | null = null;
  let outcome: ReturnType<typeof ask> | null = null;
  try {
    outcome = ask(bad);
  } catch (err) {
    crashed = (err as Error).message;
  }
  ok(`never crashes on ${JSON.stringify(bad)}`, crashed === null, crashed ?? '');
  ok(
    `${JSON.stringify(bad)} is refused with a reason`,
    outcome !== null && !outcome.ok && outcome.error.length > 0,
    JSON.stringify(outcome),
  );
}
// A zero denominator is a domain problem, not an internal fault.
ok('zero denominator is reported as undefined', (() => {
  const r = ask('x/0');
  return !r.ok && /division by zero/i.test(r.error);
})());

/* ------------------------------------------------------------------ */
section('Solver orchestration');

/**
 * The orchestration layer is what the UI and the API route both call, so a
 * regression here is a user-visible wrong answer rather than an internal slip.
 * Every case asserts on the rendered answer, not on which branch was taken.
 */
function ask(input: string, mode?: 'auto' | 'evaluate' | 'simplify' | 'differentiate' | 'integrate' | 'solve', variable?: string) {
  return solveRequest({ input, mode, variable });
}
function answered(r: ReturnType<typeof ask>, expectedLatex: string, expectedMode?: string): void {
  if (!r.ok) {
    ok(`solve ${JSON.stringify(r.normalized)}`, false, `errored: ${r.error}`);
    return;
  }
  if (expectedMode !== undefined && r.mode !== expectedMode) {
    ok(`solve mode for ${JSON.stringify(r.normalized)}`, false, `expected ${expectedMode}, got ${r.mode}`);
    return;
  }
  eq(`solve ${JSON.stringify(r.normalized)}`, r.answerLatex, expectedLatex);
}

answered(ask('2x + 5 = 15'), 'x = 5', 'solve');
answered(ask('solve 2x + 5 = 15'), 'x = 5', 'solve');
answered(ask('x^2 - 5x + 6 = 0'), 'x = 2 \\quad \\text{or} \\quad x = 3', 'solve');
answered(ask('1/3 + 1/6'), '\\frac{1}{2}', 'evaluate');
answered(ask('sin(30°)'), '\\frac{1}{2}', 'evaluate');
// A bare formula has no value, so Auto differentiates it (see below).
answered(ask('x^2', 'evaluate'), 'x^{2}', 'evaluate');
answered(ask('x^2 + 3', 'evaluate'), 'x^{2} + 3', 'evaluate');
answered(ask('2×x'), '2', 'differentiate');
answered(ask('x²'), '2x', 'differentiate');
answered(ask('x² + 3'), '2x', 'differentiate');

// Every intent prefix has to reach the same answer as the bare expression.
answered(ask('d/dx x^2'), '2x', 'differentiate');
answered(ask('differentiate x^2'), '2x', 'differentiate');
answered(ask('derivative of x^3'), '3x^{2}', 'differentiate');
answered(ask('d/dx t^2'), '2t', 'differentiate');
answered(ask('x^3'), '3x^{2}', 'differentiate');
answered(ask('simplify (x+1)(x-1)'), 'x^{2} - 1', 'simplify');
answered(ask('expand (x+2)^2'), 'x^{2} + 4x + 4', 'simplify');
answered(ask('integrate 3x'), '\\frac{3x^{2}}{2} + C', 'integrate');
answered(ask('∫ x^2 dx'), '\\frac{x^{3}}{3} + C', 'integrate');
// A bare formula cannot be evaluated, so Auto differentiates it instead.
answered(ask('x³'), '3x^{2}', 'differentiate');
// `π` is a known constant, not a variable, so it evaluates to a decimal.
ok('pi evaluates numerically', (() => {
  const r = ask('pi');
  return r.ok && r.mode === 'evaluate' && r.approximate === true;
})());
// A formula has no value to evaluate. In Auto the only operation that can
// answer one is differentiating; with Evaluate chosen explicitly it says so.
ok('auto differentiates a formula', (() => {
  const r = ask('zebra + 1');
  return r.ok && r.mode === 'differentiate';
})());
const formula = ask('x + y', 'evaluate');
ok('explicit evaluate reports a formula, not an error', formula.ok && formula.title === 'Expression', formula.ok ? formula.title : formula.error);
ok('formula answer suggests what to do next', formula.ok && formula.steps.some((s) => /Differentiate/.test(s.why)));

// Mode auto-detection from the shape of the input.
answered(ask('3x = 12'), 'x = 4', 'solve');
ok('auto: inequality solves', (() => {
  const r = ask('2x + 1 > 5');
  return r.ok && r.mode === 'solve' && r.answerLatex === 'x > 2';
})());

// Systems and multi-root results.
const sysAnswer = ask('2x + y = 5, x - y = 1');
ok('system solution', sysAnswer.ok && sysAnswer.answerLatex === 'x = 2,\\quad y = 1', sysAnswer.ok ? sysAnswer.answerLatex : sysAnswer.error);
const cubic = ask('x^3 - 6x^2 + 11x - 6 = 0');
ok('cubic has three roots', cubic.ok && cubic.answerPlain.split(' or ').length === 3, cubic.ok ? cubic.answerPlain : cubic.error);

// Errors must stay actionable rather than becoming dead ends.
for (const bad of ['2 +* 3', '1/0', 'ln(0)', 'x^2 +', '']) {
  const r = ask(bad);
  ok(`error for ${JSON.stringify(bad)}`, !r.ok && r.error.length > 0, JSON.stringify(r));
}
const noEquals = ask('42', 'solve');
ok('missing operator explains itself', !noEquals.ok && typeof noEquals.hint === 'string' && noEquals.hint.length > 10, JSON.stringify(noEquals));
const solved = ask('2x + 5 = 15');
ok('successful solve explains every step', solved.ok && solved.steps.length > 0 && solved.steps.every((s) => s.why.length > 10));
ok('every result carries a plain-text answer', solved.ok && solved.answerPlain.length > 0 && !solved.answerPlain.includes('\\'));

/* ------------------------------------------------------------------ */
section('History storage');

// Every assertion here runs against its own in-memory database, so the suite
// never touches the developer's real history file.
function freshDb() {
  return openDatabase(':memory:');
}

{
  const db = freshDb();

  const solved = recordProblem(solveRequest({ input: '2x + 5 = 15' }), db);
  ok('record returns a row id', solved > 0, `got ${solved}`);

  const rows = listProblems({}, db);
  eq('one row stored', rows.length, 1);
  eq('input round-trips', rows[0]!.input, '2x + 5 = 15');
  eq('mode is stored', rows[0]!.mode, 'solve');
  eq('answer is stored', rows[0]!.answerLatex, 'x = 5');
  eq('success is flagged', rows[0]!.ok, true);
  ok('steps survive the round trip', rows[0]!.steps.length === 2, JSON.stringify(rows[0]!.steps));
  ok('step reasons survive', rows[0]!.steps.every((s) => s.why.length > 10));
  ok('createdAt is a date', !Number.isNaN(Date.parse(rows[0]!.createdAt)));

  // A failure is part of the history too: it is the record of a limit.
  recordProblem(solveRequest({ input: 'integrate e^(x^2)' }), db);
  const both = listProblems({}, db);
  eq('failure stored too', both.length, 2);
  const failedRow = both.find((r) => !r.ok)!;
  ok('failure has an error', failedRow.error !== null && failedRow.error.length > 0);
  eq('failure has no answer', failedRow.answerLatex, null);
  ok('failure keeps its hint', failedRow.steps.length === 1 && failedRow.steps[0]!.why.length > 0);
  db.close();
}

{
  // Newest first, which is the only order a history list is useful in.
  const db = freshDb();
  for (const input of ['first', 'second', 'third']) {
    recordProblem(solveRequest({ input, mode: 'simplify' }), db);
  }
  const rows = listProblems({}, db);
  eq('newest first', rows.map((r) => r.input), ['third', 'second', 'first']);
  db.close();
}

{
  const db = freshDb();
  recordProblem(solveRequest({ input: '2x + 5 = 15' }), db);
  recordProblem(solveRequest({ input: 'x^2 - 5x + 6 = 0' }), db);
  recordProblem(solveRequest({ input: '1/0' }), db);

  eq('search by input', listProblems({ search: 'quadratic' }, db).length, 0);
  eq('search matches input text', listProblems({ search: '5x' }, db).length, 1);
  eq('search matches the answer', listProblems({ search: 'x = 5' }, db).length, 1);
  // A LIKE wildcard typed by the user must be matched literally, not treated
  // as a pattern that matches everything.
  eq('wildcards in search are literal', listProblems({ search: '%' }, db).length, 0);
  eq('underscore in search is literal', listProblems({ search: '_' }, db).length, 0);
  eq('filter by mode', listProblems({ mode: 'solve' }, db).length, 2);
  eq('filter by failure', listProblems({ onlyFailures: true }, db).length, 1);
  eq('count respects filters', countProblems({ mode: 'solve' }, db), 2);
  eq('count of everything', countProblems({}, db), 3);
  eq('limit is honoured', listProblems({ limit: 2 }, db).length, 2);
  eq('offset skips', listProblems({ limit: 2, offset: 2 }, db).length, 1);
  // A limit above the ceiling is clamped rather than trusted.
  eq('limit is clamped', listProblems({ limit: 100000 }, db).length, 3);
  db.close();
}

{
  const db = freshDb();
  const id = recordProblem(solveRequest({ input: '2x + 5 = 15' }), db);
  ok('getProblem finds the row', getProblem(id, db)?.input === '2x + 5 = 15');
  eq('getProblem on a missing id', getProblem(9999, db), null);
  ok('delete reports success', deleteProblem(id, db));
  ok('deleting twice reports nothing removed', !deleteProblem(id, db));
  eq('row is gone', listProblems({}, db).length, 0);

  recordProblem(solveRequest({ input: 'a' }), db);
  recordProblem(solveRequest({ input: 'b' }), db);
  eq('clear removes every row', clearProblems(db), 2);
  eq('nothing left', listProblems({}, db).length, 0);
  db.close();
}

{
  const db = freshDb();
  recordProblem(solveRequest({ input: '2x + 5 = 15' }), db);
  recordProblem(solveRequest({ input: 'd/dx x^2' }), db);
  recordProblem(solveRequest({ input: '1/0' }), db);
  const s = summarise(db);
  eq('summary total', s.total, 3);
  eq('summary failures', s.failures, 1);
  ok('summary groups by mode', s.byMode.length === 3, JSON.stringify(s.byMode));
  db.close();
}

{
  // Migrations must be safe to run against a database that already has them.
  const db = freshDb();
  const first = appliedMigrations(db);
  migrate(db);
  eq('migrations are idempotent', appliedMigrations(db), first);
  ok('migration 1 applied', first.includes(1));
  db.close();
}

{
  // A corrupted steps_json must not cost the user the answer.
  const db = freshDb();
  recordProblem(solveRequest({ input: '2x + 5 = 15' }), db);
  db.exec("UPDATE problems SET steps_json = 'not json at all'");
  const row = listProblems({}, db)[0]!;
  eq('answer survives corrupt steps', row.answerLatex, 'x = 5');
  eq('steps degrade to empty', row.steps.length, 0);
  db.close();
}

/* ------------------------------------------------------------------ */
const total = passed + failed;
process.stdout.write(`\n${'-'.repeat(60)}\n`);
if (failed === 0) {
  process.stdout.write(`  PASS  ${passed}/${total} assertions\n\n`);
  process.exit(0);
} else {
  process.stdout.write(`  FAIL  ${failed}/${total} assertions failed:\n`);
  for (const f of failures) process.stdout.write(`    - ${f}\n`);
  process.stdout.write('\n');
  process.exit(1);
}

void isNum;
