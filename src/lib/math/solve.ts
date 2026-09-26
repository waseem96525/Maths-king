import { type Node, ADD, FN, MUL, NUM, POW, SUB, VAR, isNum } from './ast';
import { simplify, tidy } from './simplify';
import {
  isInt,
  rat,
  radd,
  rcmp,
  rdiv,
  rmul,
  rneg,
  rsqrt,
  rsub,
  toNumber,
  toDecimalString,
  type Rational,
} from './rational';
import { collectVars, evaluate, isConstantNode, MathError } from './evaluate';
import { toLatex, isReservedName } from './latex';
import { integerRoots, polyDegree, polyMul, polyTrim, toPoly, ratEq, type Poly } from './poly';

const L = (n: Node): string => toLatex(n);
const LN = (r: Rational): string => toLatex(NUM(r));
const LX = (v: string): string => toLatex(VAR(v));

/** A single algebraic move, already rendered for display. */
export interface AlgebraStep {
  /** Rendered equation for this step, e.g. `2x = 10`. */
  latex: string;
  /** Why this move is valid — the "Why this step?" text. */
  why: string;
  /** Optional short label such as "Subtract 5 from both sides". */
  title?: string;
}

export type RootValue =
  | { kind: 'rational'; value: Rational }
  | { kind: 'radical'; sign: 1 | -1; coeff: Rational; radicand: Rational; a: Rational; b: Rational }
  | { kind: 'complex'; re: number; im: number }
  | { kind: 'irrational'; value: number };

export interface SolveResult {
  roots: RootValue[];
  steps: AlgebraStep[];
  method: string;
  variable: string;
  /** Rendered roots, e.g. `x = 2 \text{ or } x = 3`. */
  answerLatex: string;
}

export function rootLatex(root: RootValue, v: string): string {
  switch (root.kind) {
    case 'rational':
      return `${LX(v)} = ${LN(root.value)}`;
    case 'irrational':
      return `${LX(v)} \\approx ${toDecimalString(rat(root.value), 10)}`;
    case 'complex':
      return `${LX(v)} \\approx ${toDecimalString(rat(root.re), 8)} ${root.im < 0 ? '-' : '+'} ${toDecimalString(rat(Math.abs(root.im)), 8)}i`;
    case 'radical': {
      // value = coeff ± sqrt(disc) / (2a). Folding the denominator inside the
      // root keeps the answer tidy: sqrt(32)/4 collapses to sqrt(2).
      const twoA = rat(2n * root.a.n, root.a.d);
      const inside = rdiv(root.radicand, rmul(twoA, twoA));
      const isSquare = inside.n >= 0n && isPerfectRatSqrt(inside);
      const radical = isSquare ? LN(rsqrt(inside)) : `\\sqrt{${LN(inside)}}`;
      const c = root.coeff;
      const negative = root.sign < 0n;
      if (ratEq(c, rat(0n))) return `${LX(v)} = ${negative ? '-' : ''}${radical}`;
      if (isSquare) {
        // The radical is a whole number, so this collapses to a rational.
        const val = negative ? rsub(c, rsqrt(inside)) : radd(c, rsqrt(inside));
        return `${LX(v)} = ${LN(val)}`;
      }
      if (ratEq(c, rat(1n))) return `${LX(v)} = 1 ${negative ? '-' : '+'} ${radical}`;
      if (ratEq(c, rat(-1n))) return `${LX(v)} = ${negative ? '-' : '+'} 1 ${negative ? '-' : '+'} ${radical}`;
      return `${LX(v)} = ${LN(c)} ${negative ? '-' : '+'} ${radical}`;
    }
    default:
      return LX(v);
  }
}

function joinRoots(roots: RootValue[], v: string): string {
  if (roots.length === 0) return 'No solution';
  if (roots.length === 1) return rootLatex(roots[0]!, v);
  return roots.map((r) => rootLatex(r, v)).join(' \\quad \\text{or} \\quad ');
}

function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new MathError('Square root of a negative number', 'domain');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x;
}

function isPerfectRatSqrt(v: Rational): boolean {
  if (v.n < 0n) return false;
  const rn = bigintSqrt(v.n);
  const rd = bigintSqrt(v.d);
  return rn * rn === v.n && rd * rd === v.d;
}

/** Renders `x - 3` for r = 3 and `x + 3` for r = -3, as part of a factor. */
function factorBody(v: string, r: Rational): string {
  if (r.n === 0n) return LX(v);
  return r.n < 0n ? `${LX(v)} + ${LN(rneg(r))}` : `${LX(v)} - ${LN(r)}`;
}

/** Renders `+ 3` / `- 3` for use between two terms. */
function signedTerm(r: Rational): string {
  if (r.n === 0n) return '';
  return r.n < 0n ? ` - ${LN(rneg(r))}` : ` + ${LN(r)}`;
}

/** Best guess at which variable to solve for. */
function pickSolveVar(eq: Extract<Node, { t: 'eq' }>, vars: string[]): string | null {
  for (const v of vars) {
    const p = tryPoly(eq.a, v);
    const q = tryPoly(eq.b, v);
    if (p && q) {
      const merged = subtractPoly(polyMul(q, [rat(1n)]), polyMul(p, [rat(-1n)]));
      if (polyDegree(merged) === 1) return v;
    }
  }
  for (const v of vars) {
    if (isReservedName(v)) continue;
    return v;
  }
  return vars[0] ?? null;
}

function tryPoly(n: Node, v: string): Poly | null {
  try {
    return toPoly(n, v);
  } catch {
    return null;
  }
}

function subtractPoly(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) out.push(rsub(a[i] ?? rat(0n), b[i] ?? rat(0n)));
  return polyTrim(out);
}

function addPoly(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) out.push(radd(a[i] ?? rat(0n), b[i] ?? rat(0n)));
  return polyTrim(out);
}

function scalePoly(a: Poly, k: Rational): Poly {
  return polyTrim(a.map((c) => rmul(c, k)));
}

/**
 * Solve `a = b` for a single variable, producing pedagogical steps.
 * Returns null when the equation is outside the exact-algebra solver, which
 * tells the caller to hand the problem to the AI provider.
 */
export function solveEquation(eq: Node, preferredVar?: string): SolveResult | null {
  if (eq.t !== 'eq') return null;
  const vars = [...collectVars(eq)].filter((v) => !isReservedName(v));
  if (vars.length === 0) return null;
  const v = preferredVar && vars.includes(preferredVar) ? preferredVar : pickSolveVar(eq, vars);
  if (!v) return null;

  const lhs = simplify(eq.a);
  const rhs = simplify(eq.b);
  const steps: AlgebraStep[] = [];

  const leftPoly = tryPoly(lhs, v);
  const rightPoly = tryPoly(rhs, v);
  if (!leftPoly || !rightPoly) return null;
  const poly = subtractPoly(leftPoly, rightPoly);
  const degree = polyDegree(poly);

  if (degree === 0) {
    if (poly[0]!.n === 0n) return { roots: [], steps, method: 'Identity', variable: v, answerLatex: '\\text{Every value of }' + LX(v) + '\\text{ works}' };
    return null;
  }
  if (degree > 4) {
    const byFactoring = solveByRationalRoots(poly, v);
    if (byFactoring) {
      steps.unshift({
        latex: `${L({ t: 'eq', a: lhs, b: rhs } as Node)} \\quad\\Longrightarrow\\quad 0 = ${LN(poly[0]!)} + ${LN(poly[1] ?? rat(0n))}${LX(v)} + \\cdots`,
        why: `Move every term to one side so the left-hand side becomes zero. Whatever you subtract from one side you must subtract from the other, so the solution set is unchanged.`,
        title: 'Move all terms to one side',
      });
      return byFactoring;
    }
    return null;
  }

  if (degree === 1) return solveLinear(poly, v, lhs, rhs);
  if (degree === 2) return solveQuadratic(poly, v, lhs, rhs);
  if (degree >= 3) {
    const byFactoring = solveByRationalRoots(poly, v);
    if (byFactoring) {
      steps.unshift({
        latex: `${L({ t: 'eq', a: lhs, b: rhs } as Node)} \\quad\\Longrightarrow\\quad ${LX(v)}^3 + ${LN(poly[2] ?? rat(0n))}${LX(v)}^2 + ${LN(poly[1] ?? rat(0n))}${LX(v)} + ${LN(poly[0]!)} = 0`,
        why: 'Subtract the right-hand side so everything sits on one side. Then look for rational roots, which is the quickest route for a factorable polynomial.',
        title: 'Move all terms to one side',
      });
      return byFactoring;
    }
  }
  return null;
}

/** ax = b */
function solveLinear(poly: Poly, v: string, lhs: Node, rhs: Node): SolveResult | null {
  const t = polyTrim(poly);
  const a = t[1] ?? rat(0n);
  const b = t[0] ?? rat(0n);
  if (a.n === 0n) return null;
  const steps: AlgebraStep[] = [];

  steps.push({
    latex: `${L({ t: 'eq', a: lhs, b: rhs } as Node)} \\quad\\Longrightarrow\\quad ${LN(a)}${LX(v)} = ${LN(b.n === 0n ? rat(0n) : rneg(b))}`,
    why: 'Subtract the constant from both sides so only the term with the variable is left. Doing the same thing to both sides keeps the equation balanced.',
    title: 'Rearrange into ax = b',
  });

  // After the rearrangement the equation is already in `ax = c` form, so the
  // only move left is the division. An earlier version inserted an
  // "add c to both sides" round trip here; it rendered as `2x 10 = 10 10` (the
  // sign was missing) and claimed adding to both sides would zero the right-hand
  // side, which is false. Subtracting c from both sides is what cancels it, and
  // it undoes the rearrangement rather than advancing the solution.
  const rhsConst = b.n === 0n ? rat(0n) : rneg(b);
  const root = rdiv(rhsConst, a);
  steps.push({
    latex: `${LX(v)} = \\frac{${LN(rhsConst)}}{${LN(a)}} = ${LN(root)}`,
    why: `Divide both sides by ${LN(a)}, the coefficient of ${v}. Division undoes multiplication, and it must be applied to both sides to keep the equation balanced.`,
    title: `Divide both sides by ${LN(a)}`,
  });

  return {
    roots: [{ kind: 'rational', value: root }],
    steps,
    method: 'Linear equation',
    variable: v,
    answerLatex: `${LX(v)} = ${LN(root)}`,
  };
}

function factorNode(roots: Rational[], v: string): Node {
  const factors = roots.map((r) => ADD(VAR(v), NUM(rneg(r))));
  return factors.reduce((a, b) => MUL(a, b));
}

function solveQuadratic(poly: Poly, v: string, lhs: Node, rhs: Node): SolveResult | null {
  const t = polyTrim(poly);
  const a = t[2]!;
  const b = t[1]!;
  const c = t[0]!;
  if (a.n === 0n) return solveLinear(poly, v, lhs, rhs);
  const steps: AlgebraStep[] = [];

  steps.push({
    latex: `${L({ t: 'eq', a: lhs, b: rhs } as Node)} \\quad\\Longrightarrow\\quad ${LN(a)}${LX(v)}^2 ${signedTerm(b)}${LX(v)} ${signedTerm(c)} = 0`,
    why: 'Move every term to the left-hand side so the equation reads "expression = 0". That is the form the methods below expect.',
    title: 'Write in standard form',
  });

  const rationalRoots = integerRoots(t);
  const disc = rsub(rat(b.n * b.n), rat(4n * a.n * c.n));
  const discLatex = `${LN(b)}^2 - 4(${LN(a)})(${LN(c)})`;

  // Prefer factorisation when the roots are rational: it is the method a
  // student is expected to reach for first.
  if (rationalRoots.length === 2) {
    const [r1, r2] = rationalRoots as [Rational, Rational];
    const needProduct = c;
    const needSum = b;
    steps.push({
      latex: `\\text{Needed: two numbers } p, q \\text{ with } pq = ${LN(needProduct)} \\text{ and } p + q = ${LN(needSum)}`,
      why: 'To factor a monic quadratic you look for two numbers whose product is the constant term and whose sum is the coefficient of the middle term. That pair splits the quadratic in two.',
      title: 'Look for the two numbers',
    });
    steps.push({
      latex: `p = ${LN(r1)},\\ q = ${LN(r2)} \\quad (${LN(r1)} \\times ${LN(r2)} = ${LN(rmul(r1, r2))},\\ ${LN(r1)} ${r1.n < 0n && r2.n < 0n ? '+' : '+'} ${LN(r2)} = ${LN(radd(r1, r2))})`,
      why: 'These two numbers satisfy both conditions, so the factorisation exists.',
      title: 'Identify the pair',
    });
    const factored = factorNode([r1, r2], v);
    steps.push({
      latex: `${L(factored)} = 0`,
      why: 'Replacing the middle term by the difference of these two numbers reconstructs the original quadratic, and it now splits into brackets.',
      title: 'Factorise',
    });
    steps.push({
      latex: `\\left(${factorBody(v, r1)}\\right)\\left(${factorBody(v, r2)}\\right) = 0`,
      why: 'A product equals zero only when at least one of its factors equals zero, so solve each bracket separately.',
      title: 'Set each factor to zero',
    });
    steps.push({
      latex: `${LX(v)} = ${LN(r1)} \\quad\\text{or}\\quad ${LX(v)} = ${LN(r2)}`,
      why: `Solving the two small equations gives ${LX(v)} = ${LN(r1)} and ${LX(v)} = ${LN(r2)}.`,
      title: 'Solve each bracket',
    });
    return {
      roots: [
        { kind: 'rational', value: r1 },
        { kind: 'rational', value: r2 },
      ],
      steps,
      method: 'Factorisation',
      variable: v,
      answerLatex: joinRoots([{ kind: 'rational', value: r1 }, { kind: 'rational', value: r2 }], v),
    };
  }

  // Quadratic formula
  steps.push({
    latex: `\\Delta = b^2 - 4ac = (${LN(b)})^2 - 4(${LN(a)})(${LN(c)}) = ${LN(disc)}`,
    why: 'The discriminant tells you how many real roots the equation has before you solve it, and it decides whether the roots come out real, repeated, or complex.',
    title: 'Compute the discriminant',
  });
  if (disc.n > 0n) {
    steps.push({
      latex: `\\Delta = ${LN(disc)} > 0 \\quad\\Longrightarrow\\quad \\text{two distinct real roots}`,
      why: 'A positive discriminant means the equation crosses the x-axis twice, so there are two separate real solutions.',
      title: 'Interpret the discriminant',
    });
  } else if (disc.n === 0n) {
    steps.push({
      latex: `\\Delta = 0 \\quad\\Longrightarrow\\quad \\text{one repeated real root}`,
      why: 'A zero discriminant means the parabola just touches the x-axis, so both roots coincide.',
      title: 'Interpret the discriminant',
    });
  } else {
    steps.push({
      latex: `\\Delta = ${LN(disc)} < 0 \\quad\\Longrightarrow\\quad \\text{no real roots}`,
      why: 'A negative discriminant means the graph never meets the x-axis, so there are no real solutions.',
      title: 'Interpret the discriminant',
    });
  }

  const roots = quadraticRoots(a, b, c, disc);
  const twoA = rat(2n * a.n, a.d);
  if (disc.n >= 0n && isPerfectRatSqrt(disc)) {
    const s = rsqrt(disc);
    const r1 = rdiv(radd(rneg(b), s), twoA);
    const r2 = rdiv(rsub(rneg(b), s), twoA);
    steps.push({
      latex: `${LX(v)} = \\frac{${negBTerm(b)} \\pm \\sqrt{${LN(disc)}}}{${LN(twoA)}} = \\frac{${LN(rneg(b))}${signedTerm(s)}}{${LN(twoA)}}`,
      why: 'The quadratic formula gives both roots at once. The ± symbol means "try the plus sign, then the minus sign", which is why a quadratic can have two answers.',
      title: 'Apply the quadratic formula',
    });
    const distinct = rcmp(r1, r2) !== 0;
    const list: RootValue[] = distinct
      ? [
          { kind: 'rational', value: r1 },
          { kind: 'rational', value: r2 },
        ]
      : [{ kind: 'rational', value: r1 }];
    steps.push({
      latex: distinct ? `${LX(v)} = ${LN(r1)} \\quad\\text{or}\\quad ${LX(v)} = ${LN(r2)}` : `${LX(v)} = ${LN(r1)}`,
      why: distinct
        ? 'Simplifying each of the two values gives the two roots.'
        : 'Both signs give the same number here, so there is a single repeated root.',
      title: 'Simplify',
    });
    return { roots: list, steps, method: 'Quadratic formula', variable: v, answerLatex: joinRoots(list, v) };
  }

  if (disc.n < 0n) {
    steps.push({
      latex: `${LX(v)} = \\frac{${negBTerm(b)} \\pm ${iLatex(disc)}}{${LN(twoA)}}`,
      why: 'A negative discriminant has no real square root, so the roots are complex conjugates. Over the real numbers this equation has no solution.',
      title: 'Apply the quadratic formula',
    });
    return { roots, steps, method: 'Quadratic formula', variable: v, answerLatex: `\\text{No real solution} \\quad (${roots.map((r) => rootLatex(r, v)).join(', ')})` };
  }

  steps.push({
    latex: `${LX(v)} = \\frac{${negBTerm(b)} \\pm \\sqrt{${LN(disc)}}}{${LN(twoA)}}`,
    why: 'Apply the quadratic formula. The square root of the discriminant is not a whole number, so the answer stays in its exact radical form rather than a decimal.',
    title: 'Apply the quadratic formula',
  });
  steps.push({
    latex: roots.map((r) => rootLatex(r, v)).join(' \\quad\\text{or}\\quad '),
    why: 'The ± sign produces two values: one from the plus branch and one from the minus branch.',
    title: 'Write both roots',
  });
  return { roots, steps, method: 'Quadratic formula', variable: v, answerLatex: joinRoots(roots, v) };
}

/** Renders the -b term of the quadratic formula, keeping the sign visible. */
function negBTerm(b: Rational): string {
  return b.n < 0n ? `- ${LN(rneg(b))}` : LN(b);
}

function rabs(r: Rational): Rational {
  return r.n < 0n ? rneg(r) : r;
}

function iLatex(disc: Rational): string {
  return `\\sqrt{${LN(rneg(disc))}}i`;
}

function quadraticRoots(a: Rational, b: Rational, c: Rational, disc: Rational): RootValue[] {
  const twoA = rat(2n * a.n, a.d);
  const negB = rneg(b);
  if (disc.n >= 0n && isPerfectRatSqrt(disc)) {
    const s = rsqrt(disc);
    const r1 = rdiv(radd(negB, s), twoA);
    const r2 = rdiv(rsub(negB, s), twoA);
    return rcmp(r1, r2) === 0 ? [{ kind: 'rational', value: r1 }] : [{ kind: 'rational', value: r1 }, { kind: 'rational', value: r2 }];
  }
  if (disc.n < 0n) {
    const re = toNumber(rdiv(negB, twoA));
    const im = toNumber(rdiv(rsqrt(rneg(disc)), twoA));
    return [
      { kind: 'complex', re, im: Math.abs(im) },
      { kind: 'complex', re, im: -Math.abs(im) },
    ];
  }
  return [
    { kind: 'radical', sign: 1, coeff: rdiv(negB, twoA), radicand: disc, a, b },
    { kind: 'radical', sign: -1, coeff: rdiv(negB, twoA), radicand: disc, a, b },
  ];
}

/** Higher degrees: rational root theorem plus synthetic division. */
function solveByRationalRoots(poly: Poly, v: string): SolveResult | null {
  const t = polyTrim(poly);
  const deg = polyDegree(t);
  const roots = integerRoots(t);
  if (roots.length === 0 || roots.length > deg) return null;
  const steps: AlgebraStep[] = [];
  const list = roots.map((r) => ({ kind: 'rational' as const, value: r }));
  steps.push({
    latex: `\\text{Rational root candidates tested against } ${LN(t[0]!)} \\text{ and } ${LN(t[t.length - 1]!)}`,
    why: 'The rational root theorem says any rational root of a polynomial with integer coefficients must have a numerator dividing the constant term and a denominator dividing the leading coefficient. Testing those candidates is quick and exact.',
    title: 'Use the rational root theorem',
  });
  steps.push({
    latex: `\\text{Roots found: } ${roots.map((r) => LN(r)).join(', ')}`,
    why: 'These values make the polynomial exactly zero, so each one is a genuine root.',
    title: 'Confirm the roots',
  });
  return {
    roots: list,
    steps,
    method: 'Factorisation by rational roots',
    variable: v,
    answerLatex: joinRoots(list, v),
  };
}

/* -------------------------------------------------------------------------- */
/* Systems of linear equations                                                  */
/* -------------------------------------------------------------------------- */

export interface SystemResult {
  solution: Record<string, Rational> | null;
  kind: 'unique' | 'infinite' | 'none';
  steps: AlgebraStep[];
  variables: string[];
  determinant: Rational | null;
}

export function solveLinearSystem(equations: Node[]): SystemResult | null {
  const eqs = equations.filter((e): e is Extract<Node, { t: 'eq' }> => e.t === 'eq');
  if (eqs.length < 2) return null;
  const allVars = new Set<string>();
  for (const e of eqs) for (const v of collectVars(e)) if (!isReservedName(v)) allVars.add(v);
  const variables = [...allVars];
  if (variables.length === 0 || variables.length > eqs.length) return null;

  // Coefficient matrix over the rationals.
  const rows: Rational[][] = [];
  for (const eq of eqs) {
    const d = tidy(SUB(eq.a, eq.b));
    const coeffs: Rational[] = [];
    for (const v of variables) {
      const p = tryPoly(d, v);
      if (!p || polyDegree(p) > 1) return null;
      coeffs.push(p[1] ?? rat(0n));
    }
    // Constant = d minus every linear term. `tidy` expands and collects, so
    // any variable that genuinely cancels here really is gone.
    let rest = d;
    for (let i = 0; i < variables.length; i++) {
      if (coeffs[i]!.n === 0n) continue;
      rest = tidy(SUB(rest, MUL(NUM(coeffs[i]!), VAR(variables[i]!))));
    }
    const restPoly = tryPoly(rest, '__no_var__');
    if (!restPoly || restPoly.length !== 1) return null;
    // `d` is LHS - RHS, so the augmented column is the negated constant.
    rows.push([...coeffs, rneg(restPoly[0]!)]);
  }

  const steps: AlgebraStep[] = [];
  const m = rows.map((r) => [...r]);
  const n = variables.length;
  steps.push({
    latex: matrixLatex(variables, m),
    why: `Rewrite every equation in the form ${variables.map((v) => `a${v}`).join(' + ')} = c, then line the coefficients up in an augmented matrix. Each row is one equation and each column is one variable.`,
    title: 'Build the augmented matrix',
  });

  let pivotRow = 0;
  const pivotCols: number[] = [];
  for (let col = 0; col < n && pivotRow < m.length; col++) {
    let sel = -1;
    for (let r = pivotRow; r < m.length; r++) {
      if (m[r]![col]!.n !== 0n) {
        sel = r;
        break;
      }
    }
    if (sel < 0) continue;
    if (sel !== pivotRow) {
      const tmp = m[sel]!;
      m[sel] = m[pivotRow]!;
      m[pivotRow] = tmp;
      steps.push({ latex: matrixLatex(variables, m), why: 'Swap two rows so that a non-zero pivot sits under this column.', title: 'Reorder the rows' });
    }
    const p = m[pivotRow]![col]!;
    if (!ratEq(p, rat(1n))) {
      m[pivotRow] = m[pivotRow]!.map((c) => (c.n === 0n ? c : rdiv(c, p)));
      steps.push({
        latex: `R${pivotRow + 1} \\div ${LN(p)} \\;\\Longrightarrow\\; ${matrixLatex(variables, m)}`,
        why: `Divide the whole row by ${LN(p)} so the leading entry becomes exactly 1. A leading 1 makes the elimination step easy to follow.`,
        title: 'Normalise the pivot',
      });
    }
    for (let r = 0; r < m.length; r++) {
      if (r === pivotRow) continue;
      const f = m[r]![col]!;
      if (f.n === 0n) continue;
      m[r] = m[r]!.map((c, i) => rsub(c, rmul(f, m[pivotRow]![i]!)));
      steps.push({
        latex: `R${r + 1} - (${LN(f)})\\,R${pivotRow + 1} \\;\\Longrightarrow\\; ${matrixLatex(variables, m)}`,
        why: `Subtract ${LN(f)} times the pivot row from this row. That zeroes the entry under ${variables[col]} without disturbing the pivot itself, because a row can be changed by adding a multiple of another row.`,
        title: `Eliminate ${variables[col]} from row ${r + 1}`,
      });
    }
    pivotCols.push(col);
    pivotRow++;
  }

  for (let r = pivotRow; r < m.length; r++) {
    if (m[r]!.slice(0, n).every((c) => c.n === 0n) && m[r]![n]!.n !== 0n) {
      steps.push({
        latex: `0 = ${LN(m[r]![n]!)} \\quad\\Longrightarrow\\quad \\text{no solution}`,
        why: 'A row that reads "zero equals a non-zero number" is impossible, so the two equations contradict each other and the system has no solution.',
        title: 'Detect the contradiction',
      });
      return { solution: null, kind: 'none', steps, variables, determinant: null };
    }
  }
  if (pivotCols.length < n) {
    steps.push({
      latex: '\\text{One equation is a combination of the others} \\quad\\Longrightarrow\\quad \\text{infinitely many solutions}',
      why: 'There are fewer pivots than variables, so at least one variable is free. Any value of that variable works as long as the others follow from the equations.',
      title: 'Detect the free variable',
    });
    return { solution: null, kind: 'infinite', steps, variables, determinant: null };
  }

  const solution: Record<string, Rational> = {};
  for (let i = 0; i < pivotCols.length; i++) solution[variables[pivotCols[i]!]!] = m[i]![n]!;
  steps.push({
    latex: matrixLatex(variables, m),
    why: 'The matrix is now in reduced row-echelon form: every variable has a leading 1 in its own row, so its value can be read straight off.',
    title: 'Read off the solution',
  });
  steps.push({
    latex: variables.map((v) => `${v} = ${LN(solution[v]!)}`).join(',\\quad '),
    why: 'Each row now states the value of one variable directly.',
    title: 'State the values',
  });

  return {
    solution,
    kind: 'unique',
    steps,
    variables,
    determinant: variables.length === 2 ? rat(rsub(rmul(rows[0]![0]!, rows[1]![1]!), rmul(rows[0]![1]!, rows[1]![0]!))) : null,
  };
}

function matrixLatex(variables: string[], m: Rational[][]): string {
  const head = [...variables, '\\;|\\;'].map((h) => (h.startsWith('\\') ? h : h)).join(' & ');
  const body = m.map((r) => r.map((c) => LN(c)).join(' & ')).join(' \\\\ ');
  return `\\begin{pmatrix} ${head} \\\\ ${body} \\end{pmatrix}`;
}

/* -------------------------------------------------------------------------- */
/* Inequality solving                                                          */
/* -------------------------------------------------------------------------- */

export interface InequalityResult {
  steps: AlgebraStep[];
  /** Rendered solution set, e.g. `x > 5`. */
  solutionLatex: string;
  intervalLatex: string;
  kind: 'linear' | 'identity' | 'none';
  variable: string;
}

export function solveLinearInequality(cmp: Extract<Node, { t: 'cmp' }>): InequalityResult | null {
  const vars = [...collectVars(cmp.a), ...collectVars(cmp.b)].filter((v) => !isReservedName(v));
  if (vars.length === 0) return null;
  const v = vars[0]!;
  const pa = tryPoly(cmp.a, v);
  const pb = tryPoly(cmp.b, v);
  if (!pa || !pb) return null;
  const pa2 = polyTrim(pa);
  const pb2 = polyTrim(pb);
  if (polyDegree(pa2) > 1 || polyDegree(pb2) > 1) return null;
  // Normalise to a*x + b OP 0
  const a = rsub(pa2[1] ?? rat(0n), pb2[1] ?? rat(0n));
  const b = rsub(pa2[0] ?? rat(0n), pb2[0] ?? rat(0n));
  const steps: AlgebraStep[] = [];
  const flipped = a.n < 0n;
  const op = flipped ? flipOp(cmp.op) : cmp.op;
  steps.push({
    latex: `${L(cmp)} \\quad\\Longrightarrow\\quad ${LN(a)}${LX(v)} ${opLatex(op)} ${LN(b.n === 0n ? rat(0n) : rneg(b))}`,
    why: 'Collect the variable terms on the left and the constants on the right so the inequality has the form ax on one side.',
    title: 'Collect the terms',
  });
  if (a.n === 0n) {
    const holds = testInequality(b, cmp.op);
    return {
      steps: [
        ...steps,
        {
          latex: `0 ${opLatex(cmp.op)} ${LN(b)} \\quad\\Longrightarrow\\quad \\text{${holds ? 'always true' : 'never true'}}`,
          why: 'There is no variable left, so the truth of the inequality does not depend on the value chosen. This happens when both sides were the same expression.',
          title: 'Check the constant statement',
        },
      ],
      solutionLatex: holds ? '\\text{All real numbers}' : '\\varnothing',
      intervalLatex: holds ? '(-∞, ∞)' : '∅',
      kind: holds ? 'identity' : 'none',
      variable: v,
    };
  }
  // The normalised form is `a*x OP -b`, so the critical value is -b/a.
  const bound = rdiv(rneg(b), a);
  const finalOp = flipped ? flipOp(cmp.op) : cmp.op;
  steps.push({
    latex: `${LN(a)}${LX(v)} ${opLatex(op)} ${LN(b)} \\quad\\Longrightarrow\\quad ${LX(v)} ${opLatex(finalOp)} ${LN(bound)}`,
    why:
      flipped
        ? 'The coefficient of the variable is negative, so dividing by it flips the direction of the inequality. Dividing both sides by a negative number reverses "less than" to "greater than".'
        : 'Divide both sides by the coefficient. Because the coefficient is positive the direction of the inequality stays the same.',
    title: 'Divide by the coefficient of the variable',
  });
  const lb = cmp.op === '>' || cmp.op === '>=' ? '\\left(' : '\\left[';
  const rb = cmp.op === '>' || cmp.op === '>=' ? '\\right)' : '\\right]';
  const lo = cmp.op === '>' || cmp.op === '>=' ? `${LN(bound)}` : '-∞';
  const hi = cmp.op === '<' || cmp.op === '<=' ? `${LN(bound)}` : '∞';
  return {
    steps,
    solutionLatex: `${LX(v)} ${opLatex(finalOp)} ${LN(bound)}`,
    intervalLatex: `${lb}${lo}, ${hi}${rb}`,
    kind: 'linear',
    variable: v,
  };
}

function testInequality(b: Rational, op: string): boolean {
  switch (op) {
    case '<':
      return b.n > 0n;
    case '>':
      return b.n < 0n;
    case '<=':
      return b.n >= 0n;
    case '>=':
      return b.n <= 0n;
    case '!=':
      return b.n !== 0n;
    default:
      return false;
  }
}

function flipOp(op: string): string {
  switch (op) {
    case '<':
      return '>';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '>=':
      return '<=';
    default:
      return op;
  }
}

function opLatex(op: string): string {
  switch (op) {
    case '<':
      return '<';
    case '>':
      return '>';
    case '<=':
      return '\\leq';
    case '>=':
      return '\\geq';
    case '!=':
      return '\\neq';
    default:
      return op;
  }
}

/* -------------------------------------------------------------------------- */
/* Verification helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Substitutes a value for a variable and evaluates, returning a finite number. */
export function valueAt(nodeToEval: Node, v: string, value: number): number | null {
  try {
    const out = evaluate(nodeToEval, { [v]: value });
    return Number.isFinite(out) ? out : null;
  } catch {
    return null;
  }
}

export { isInt, rat, radd, rcmp, rdiv, rmul, rneg, rsub, rsqrt, toNumber, toDecimalString, toPoly, polyDegree, polyTrim, polyMul, ratEq, isNum, simplify, ADD, SUB, MUL, POW, FN, NUM, VAR, evaluate, collectVars, isConstantNode, MathError, toLatex, addPoly, subtractPoly, scalePoly, isInt as _isInt, integerRoots };
export type { Rational, Poly };
