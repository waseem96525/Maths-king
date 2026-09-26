import {
  ADD,
  CMP,
  CONST,
  DIV,
  EQ,
  FN,
  MUL,
  NEG,
  NUM,
  POW,
  SUB,
  VAR,
  type Node,
  isNum,
} from './ast';
import {
  DivisionByZeroError,
  isInt,
  isZero,
  rat,
  radd,
  rdiv,
  rmul,
  rneg,
  rsub,
  toNumber,
  type Rational,
} from './rational';
import { MathError, collectVars, isConstantNode } from './evaluate';
import { isReservedName, toPlain } from './latex';
import { polyAdd, polyMul, polyScale, polyToNode, ratEq, toPoly, isNegativeNode } from './poly';

const R0 = rat(0n);
const R1 = rat(1n);

type NumNode = Extract<Node, { t: 'num' }>;

function num(v: bigint | number): Node {
  return NUM(rat(v));
}

/** Proper type guard so the compiler narrows the node to a numeric literal. */
function isNumNode(n: Node): n is NumNode {
  return n.t === 'num';
}

function isNumValue(n: Node, v: ReturnType<typeof rat>): boolean {
  return n.t === 'num' && ratEq(n.v, v);
}

/** Structural simplification: constant folding and identity elimination. */
export function simplify(n: Node, depth = 0): Node {
  if (depth > 96) return n;
  switch (n.t) {
    case 'num':
    case 'var':
    case 'const':
      return n;
    case '+': {
      const a = simplify(n.a, depth + 1);
      const b = simplify(n.b, depth + 1);
      if (isNumValue(a, R0)) return b;
      if (isNumValue(b, R0)) return a;
      if (isNumNode(a) && isNumNode(b)) return NUM(radd(a.v, b.v));
      // a + (-k) reads better as a - k
      if (isNumNode(b) && b.v.n < 0n) return SUB(a, NUM(rneg(b.v)));
      return ADD(a, b);
    }
    case '-': {
      const a = simplify(n.a, depth + 1);
      const b = simplify(n.b, depth + 1);
      if (isNumValue(b, R0)) return a;
      if (isNumNode(a) && isNumNode(b)) {
        if (ratEq(a.v, b.v)) return num(0n);
        return NUM(rsub(a.v, b.v));
      }
      if (isNumValue(a, R0)) return NEG(b);
      if (b.t === 'neg') return ADD(a, simplify(b.a, depth + 1));
      return SUB(a, b);
    }
    case 'neg': {
      const a = simplify(n.a, depth + 1);
      if (isNumNode(a)) return NUM(rneg(a.v));
      if (a.t === 'neg') return a.a;
      return NEG(a);
    }
    case '*': {
      const a = simplify(n.a, depth + 1);
      const b = simplify(n.b, depth + 1);
      if (isNumValue(a, R0) || isNumValue(b, R0)) return num(0n);
      if (isNumValue(a, R1)) return b;
      if (isNumValue(b, R1)) return a;
      if (isNumNode(a) && isNumNode(b)) return NUM(rmul(a.v, b.v));
      // Keep a numeric factor on the left so "2(x+1)" beats "(x+1)2".
      if (!isNumNode(a) && isNumNode(b)) return MUL(b, a);
      if (a.t === 'neg') return NEG(MUL(a.a, b));
      // Fold a variable onto itself so like terms have one canonical shape:
      // x*x and x*x^3 become x^2 and x^4, which is what lets collection match
      // them against the same term written a third way.
      if (a.t === 'var' && b.t === '^' && b.a.t === 'var' && b.a.name === a.name && isNumNode(b.b) && b.b.v.d === 1n && b.b.v.n > 0n && b.b.v.n < 1024n) {
        return POW(a, NUM(rat(b.b.v.n + 1n)));
      }
      if (a.t === 'var' && b.t === 'var' && a.name === b.name) return POW(a, NUM(rat(2n)));
      // Fold matching powers: x^2 * x^3 becomes x^5. Without this the unexpanded
      // (x*x)^2 that expand() leaves in a denominator renders as `x^2x^2`.
      // Restricted to a variable base, where the identity cannot be spoiled by a
      // zero factor, and to a non-zero total exponent so x^0 is left to `^`.
      if (
        a.t === '^' &&
        b.t === '^' &&
        a.a.t === 'var' &&
        b.a.t === 'var' &&
        a.a.name === b.a.name &&
        isNumNode(a.b) &&
        isNumNode(b.b) &&
        a.b.v.d === 1n &&
        b.b.v.d === 1n
      ) {
        const total = a.b.v.n + b.b.v.n;
        if (total !== 0n && total > -1024n && total < 1024n) return POW(a.a, NUM(rat(total)));
      }
      // Regroup a trailing coefficient: (x * 2) * 3 -> (x * 6).
      if (isNumNode(a) && b.t === '*' && isNumNode(b.a)) return MUL(NUM(rmul(a.v, b.a.v)), b.b);
      if (a.t === '*' && isNumNode(a.a) && isNumNode(b)) return MUL(NUM(rmul(a.a.v, b.v)), a.b);
      return MUL(a, b);
    }
    case '/': {
      const a = simplify(n.a, depth + 1);
      const b = simplify(n.b, depth + 1);
      if (isNumValue(b, R0)) throw new MathError('Division by zero is undefined', 'division_by_zero');
      if (isNumValue(b, R1)) return a;
      if (isNumValue(a, R0)) return num(0n);
      if (isNumNode(a) && isNumNode(b)) return NUM(rdiv(a.v, b.v));
      // 6/2x -> 3/x, and 6/x2 -> 3/x^2
      if (isNumNode(a) && b.t === 'num' && !ratEq(b.v, R1)) {
        const c = rdiv(a.v, b.v);
        if (c.d === 1n) return c.n === 1n ? b : DIV(num(c.n), b);
        return DIV(NUM(c), num(1n));
      }
      if (a.t === 'neg') return NEG(DIV(a.a, b));
      return DIV(a, b);
    }
    case '^': {
      const a = simplify(n.a, depth + 1);
      const b = simplify(n.b, depth + 1);
      if (isNumValue(b, R0)) return num(1n);
      if (isNumValue(b, R1)) return a;
      if (isNumValue(a, R1)) return b;
      if (isNumValue(a, R0)) return num(0n);
      if (isNumNode(a) && isNumNode(b) && isInt(b.v) && b.v.n >= 0n && b.v.n <= 64n) {
        return NUM(bigintPow(a.v, b.v.n));
      }
      if (b.t === 'num' && a.t === 'num' && b.v.n === 1n) return a;
      return POW(a, b);
    }
    case 'fn': {
      const args = n.args.map((a) => simplify(a, depth + 1));
      if (args.length === 1 && isNumNode(args[0]!)) {
        const folded = foldConstantFn(n.name, args[0].v);
        if (folded) return folded;
      }
      if (n.name === 'sqrt' && isNumNode(args[0]!) && args[0].v.n >= 0n) {
        const p = ratPerfectSqrt(args[0].v);
        if (p) return NUM(p);
      }
      if (n.name === 'log' && args.length === 1 && isNumNode(args[0]!) && args[0].v.d === 1n) {
        const v = args[0].v.n;
        if (v === 10n) return num(1n);
        if (v === 100n) return num(2n);
        if (v === 1000n) return num(3n);
        if (v === 1n) return num(0n);
      }
      return { t: 'fn', name: n.name, args };
    }
    case 'eq':
      return { t: 'eq', a: simplify(n.a, depth + 1), b: simplify(n.b, depth + 1) };
    case 'cmp':
      return { t: 'cmp', op: n.op, a: simplify(n.a, depth + 1), b: simplify(n.b, depth + 1) };
    default: {
      const never: never = n;
      return never;
    }
  }
}

function bigintPow(base: ReturnType<typeof rat>, e: bigint): ReturnType<typeof rat> {
  let result = R1;
  let acc = base;
  let k = e;
  while (k > 0n) {
    if (k & 1n) result = rmul(result, acc);
    acc = rmul(acc, acc);
    k >>= 1n;
  }
  return result;
}

function ratPerfectSqrt(v: ReturnType<typeof rat>): ReturnType<typeof rat> | null {
  const n = v.n;
  const d = v.d;
  if (n < 0n) return null;
  const rn = isqrt(n);
  const rd = isqrt(d);
  if (rn * rn !== n || rd * rd !== d || rd === 0n) return null;
  return rat(rn, rd);
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x;
}

function foldConstantFn(name: string, v: ReturnType<typeof rat>): Node | null {
  switch (name) {
    case 'abs':
      return NUM(rat(v.n < 0n ? -1n : 1n));
    case 'sign':
      return num(v.n === 0n ? 0 : v.n > 0n ? 1 : -1);
    case 'floor':
      return num(floorRat(v));
    case 'ceil':
      return num(ceilRat(v));
    case 'round':
      return num(floorRat(radd(v, rat(1n, 2n))));
    case 'fact':
      if (v.d !== 1n || v.n < 0n || v.n > 200n) return null;
      return num(factBig(v.n));
    case 'gcd': // handled elsewhere
    case 'lcm':
      return null;
    // `deg(x)` and `rad(x)` were already rewritten to a plain multiple of pi
    // when the input was parsed, so there is nothing left to do here. The
    // parser owns the conversion so that every consumer sees one shape.
    case 'deg':
    case 'rad':
      return null;
    case 'log2': {
      if (v.d === 1n && v.n > 0n) {
        let k = 0n;
        let m = v.n;
        while (m % 2n === 0n) {
          m /= 2n;
          k++;
        }
        if (m === 1n) return num(k);
      }
      return null;
    }
    case 'log': {
      if (v.d === 1n && v.n > 0n) {
        let k = 0n;
        let m = v.n;
        while (m % 10n === 0n) {
          m /= 10n;
          k++;
        }
        if (m === 1n) return num(k);
      }
      return null;
    }
    default:
      return null;
  }
}

function floorRat(v: ReturnType<typeof rat>): bigint {
  const q = v.n / v.d;
  return v.n < 0n && q * v.d !== v.n ? q - 1n : q;
}
function ceilRat(v: ReturnType<typeof rat>): bigint {
  const q = v.n / v.d;
  return v.n > 0n && q * v.d !== v.n ? q + 1n : q;
}
function factBig(n: bigint): bigint {
  let acc = 1n;
  for (let i = 2n; i <= n; i++) acc *= i;
  return acc;
}

/** Distribute products over sums and expand small integer powers. */
export function expand(n: Node, depth = 0): Node {
  if (depth > 64) return n;
  switch (n.t) {
    case '+':
      return ADD(expand(n.a, depth + 1), expand(n.b, depth + 1));
    case '-':
      return SUB(expand(n.a, depth + 1), expand(n.b, depth + 1));
    case 'neg':
      return NEG(expand(n.a, depth + 1));
    case '*': {
      const a = expand(n.a, depth + 1);
      const b = expand(n.b, depth + 1);
      // Distributing over a difference keeps both leading terms positive:
      // a(b - c) is a*b - a*c, not -(a*b) - a*c.
      if (a.t === '+' || a.t === '-') {
        const left = expand(MUL(a.a, b), depth + 1);
        const right = expand(MUL(a.b, b), depth + 1);
        return simplify(a.t === '+' ? ADD(left, right) : SUB(left, right));
      }
      if (b.t === '+' || b.t === '-') {
        const left = expand(MUL(a, b.a), depth + 1);
        const right = expand(MUL(a, b.b), depth + 1);
        return simplify(b.t === '+' ? ADD(left, right) : SUB(left, right));
      }
      return MUL(a, b);
    }
    case '/': {
      const a = expand(n.a, depth + 1);
      const b = expand(n.b, depth + 1);
      if (a.t === '+' || a.t === '-') {
        const left = DIV(a.a, b);
        const right = DIV(a.b, b);
        return simplify(a.t === '+' ? ADD(left, right) : SUB(left, right));
      }
      return DIV(a, b);
    }
    case '^': {
      const base = expand(n.a, depth + 1);
      if (isNum(n.b) && isInt(n.b.v) && n.b.v.n >= 2n && n.b.v.n <= 12n) {
        const k = Number(n.b.v.n);
        let acc: Node = num(1n);
        for (let i = 0; i < k; i++) acc = expand(MUL(base, acc), depth + 1);
        return simplify(acc);
      }
      return POW(base, n.b);
    }
    case 'fn':
      return { t: 'fn', name: n.name, args: n.args.map((a) => expand(a, depth + 1)) };
    default:
      return n;
  }
}

/**
 * Canonicalise a polynomial in a single variable: `2x + 5x` becomes `7x`.
 * Returns null when the node is not a polynomial in that variable.
 *
 * Crucially this also rejects nodes mentioning any *other* variable. `toPoly`
 * on its own happily treats `y` as a constant, which is what coefficient
 * extraction in the system solver wants, but collecting `2x + y - 5` as a
 * polynomial in `x` would then silently delete the `y`.
 */
export function collectPolynomial(n: Node, v: string): Node | null {
  for (const other of collectVars(n)) {
    if (other !== v) return null;
  }
  try {
    const p = toPoly(n, v);
    if (!p) return null;
    return polyToNode(p, v);
  } catch (err) {
    if (err instanceof DivisionByZeroError) return null;
    return null;
  }
}

/** Variable names that appear linearly (power exactly 1) in the expression. */
export function linearVariables(n: Node): string[] {
  const vars = [...collectVars(n)];
  return vars.filter((v) => {
    let degree = 0;
    const walk = (x: Node, mul: number): void => {
      switch (x.t) {
        case 'var':
          if (x.name === v) degree += mul;
          return;
        case 'num':
        case 'const':
          return;
        case '+':
        case '-':
          walk(x.a, mul);
          walk(x.b, mul);
          return;
        case 'neg':
          walk(x.a, mul);
          return;
        case '*':
          walk(x.a, mul);
          walk(x.b, mul);
          return;
        case '/':
          walk(x.a, mul);
          walk(x.b, -mul);
          return;
        case '^':
          if (x.a.t === 'var' && x.a.name === v && isNum(x.b)) degree += mul * Number(x.b.v.n);
          else if (x.b.t === 'var' && x.b.name === v) degree = Number.POSITIVE_INFINITY;
          return;
        default:
          degree = Number.POSITIVE_INFINITY;
      }
    };
    walk(n, 1);
    return degree === 1;
  });
}

/**
 * Fully expand, simplify and collect like terms.
 *
 * With no explicit variable list every free variable in the node is collected,
 * because that is what a step almost always wants: `2x + 5x` has to come back
 * as `7x`, and only the caller knows better for the rare multivariate case.
 */
/**
 * Flatten a sum/difference tree into signed terms.
 *
 *   x^2 - 2x + 1  ->  [{x^2, +1}, {2x, -1}, {1, +1}]
 */
function flattenSum(n: Node, sign: 1 | -1, out: Array<{ term: Node; sign: 1 | -1 }>): void {
  if (n.t === '+') {
    flattenSum(n.a, sign, out);
    flattenSum(n.b, sign, out);
    return;
  }
  if (n.t === '-') {
    flattenSum(n.a, sign, out);
    flattenSum(n.b, sign === 1 ? -1 : 1, out);
    return;
  }
  if (n.t === 'neg') {
    flattenSum(n.a, sign === 1 ? -1 : 1, out);
    return;
  }
  out.push({ term: n, sign });
}

/** True when the node contains a sum anywhere that is safe to flatten. */
function hasSum(n: Node, depth = 0): boolean {
  if (depth > 64) return false;
  switch (n.t) {
    case '+':
    case '-':
      return true;
    case 'eq':
    case 'cmp':
      return false;
    case 'neg':
      return hasSum(n.a, depth + 1);
    case 'fn':
      return n.args.some((a) => hasSum(a, depth + 1));
    default:
      return false;
  }
}

/** Split `3x^2` into the coefficient 3 and the bare term `x^2`. */
function splitCoefficient(n: Node): { coeff: Rational; rest: Node } {
  if (isNumNode(n)) return { coeff: n.v, rest: NUM(R1) };
  if (n.t === '*') {
    if (isNumNode(n.a)) return { coeff: n.a.v, rest: n.b };
    if (isNumNode(n.b)) return { coeff: n.b.v, rest: n.a };
  }
  return { coeff: R1, rest: n };
}

/** Rebuild `n` with every child position replaced by `f(child)`. */
function mapChildren(n: Node, f: (child: Node) => Node): Node {
  switch (n.t) {
    case '+':
    case '-': {
      const a = f(n.a);
      const b = f(n.b);
      if (a === n.a && b === n.b) return n;
      return n.t === '+' ? ADD(a, b) : SUB(a, b);
    }
    case '*': {
      const a = f(n.a);
      const b = f(n.b);
      return a === n.a && b === n.b ? n : MUL(a, b);
    }
    case '/': {
      const a = f(n.a);
      const b = f(n.b);
      return a === n.a && b === n.b ? n : DIV(a, b);
    }
    case '^': {
      const a = f(n.a);
      const b = f(n.b);
      return a === n.a && b === n.b ? n : POW(a, b);
    }
    case 'neg': {
      const a = f(n.a);
      return a === n.a ? n : NEG(a);
    }
    case 'fn': {
      const args = n.args.map(f);
      return args.every((a, i) => a === n.args[i]) ? n : { t: 'fn', name: n.name, args };
    }
    case 'eq': {
      const a = f(n.a);
      const b = f(n.b);
      return a === n.a && b === n.b ? n : EQ(a, b);
    }
    case 'cmp': {
      const a = f(n.a);
      const b = f(n.b);
      return a === n.a && b === n.b ? n : CMP(n.op, a, b);
    }
    default:
      return n;
  }
}

/**
 * Collect like terms everywhere in the tree, not just at the top.
 *
 * The flattening below treats anything that is not `+`/`-` as one opaque term,
 * so a sum sitting in a denominator or a function argument would never be
 * collected. Working bottom-up is what keeps a derivative of `(x+1)^-2`
 * reading `-\frac{2}{x^3 + 3x^2 + 3x + 1}` instead of listing every term the
 * expansion happened to produce.
 */
function collectDeep(n: Node, depth: number): Node {
  if (depth > 24) return n;
  return collectHere(mapChildren(n, (child) => collectDeep(child, depth + 1)));
}

/**
 * Combine terms that differ only in their numeric coefficient, so `2x + 5x + y`
 * becomes `7x + y`.
 *
 * This is structural rather than polynomial-based, which is what lets it handle
 * any number of variables and leave non-polynomial terms (`sin(x)`, `1/x`)
 * alone instead of rejecting the whole expression the way single-variable
 * collection has to.
 */
export function collectLikeTerms(n: Node): Node {
  return collectDeep(n, 0);
}

function collectHere(n: Node): Node {
  if (!hasSum(n)) return n;
  const flat: Array<{ term: Node; sign: 1 | -1 }> = [];
  flattenSum(n, 1, flat);
  if (flat.length < 2) return n;

  const groups = new Map<string, { rest: Node; coeff: Rational; order: number }>();
  for (let i = 0; i < flat.length; i++) {
    const { term, sign } = flat[i]!;
    const { coeff, rest } = splitCoefficient(term);
    const signed = sign === 1 ? coeff : rneg(coeff);
    const key = toPlain(rest);
    const existing = groups.get(key);
    if (existing) existing.coeff = radd(existing.coeff, signed);
    else groups.set(key, { rest, coeff: signed, order: i });
  }
  if (groups.size === flat.length) return n;

  const parts = [...groups.values()].filter((g) => g.coeff.n !== 0n).sort((a, b) => a.order - b.order);
  if (parts.length === 0) return num(0n);
  // Every part is built the same way, the first one included: treating the
  // leading coefficient as a bare number would silently drop its variable.
  let out: Node | null = null;
  for (const p of parts) {
    const negative = p.coeff.n < 0n;
    const mag = negative ? rneg(p.coeff) : p.coeff;
    const term = ratEq(mag, R1) ? p.rest : MUL(NUM(mag), p.rest);
    if (out === null) out = negative ? NEG(term) : term;
    else out = negative ? SUB(out, term) : ADD(out, term);
  }
  return simplify(out ?? num(0n));
}

/** Fully expand, simplify and collect like terms.
 *
 * With no explicit variable list every free variable in the node is offered to
 * the polynomial collector, then structural collection mops up. The structural
 * pass is what actually makes `2x + 5x + y` come back as `7x + y`.
 */
export function tidy(n: Node, vars: string | string[] = []): Node {
  const list = typeof vars === 'string' ? [vars] : vars;
  let out = simplify(expand(n));
  const targets = list.length > 0 ? list : [...collectVars(out)].filter((v) => !isReservedName(v));
  for (const v of targets) {
    const c = collectPolynomial(out, v);
    if (c) {
      out = simplify(c);
    }
  }
  // A second pass collects across variables introduced by the first pass.
  if (targets.length > 1) {
    for (const v of targets) {
      const c = collectPolynomial(out, v);
      if (c) out = simplify(c);
    }
  }
  // Structural collection catches what the single-variable pass cannot, such
  // as `2x + 5x + y` where `y` blocks polynomial collection in `x`.
  return collectLikeTerms(out);
}

/** Numeric-only subtree, used to detect "this step is a number times x". */
export function coefficientOf(n: Node, v: string): { coeff: Node | null; rest: Node | null } {
  if (isConstantNode(n)) return { coeff: n, rest: null };
  if (n.t === '*') {
    const a = n.a;
    const b = n.b;
    if (isConstantNode(a) && !isConstantNode(b)) return { coeff: a, rest: b };
    if (isConstantNode(b) && !isConstantNode(a)) return { coeff: b, rest: a };
  }
  return { coeff: null, rest: null };
}

export { FN, VAR, CONST, DIV, MUL, NUM, POW, ADD, SUB, NEG, polyAdd, polyMul, polyScale, toNumber };
