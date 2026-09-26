import { ADD, DIV, FN, MUL, NEG, NUM, POW, SUB, VAR, type Node, isNum } from './ast';
import { rat, rdiv, toNumber, type Rational } from './rational';
import { evaluate, evaluateExact, MathError } from './evaluate';
import { polyDegree, polyToNode, toPoly } from './poly';
import { expand, simplify } from './simplify';

export interface IndefiniteResult {
  antiderivative: Node;
  /** True when a constant of integration `+ C` must be shown. */
  hasConstant: true;
  /** Rules used, in the order they were applied â€” drives the step copy. */
  rules: string[];
}

const ONE = NUM(rat(1n));

/** The antiderivative of 1/x is ln|x|; the modulus matters for negative x. */
function lnAbs(x: Node): Node {
  return FN('ln', [FN('abs', [x])]);
}

/** True for a denominator that is exactly 1/x, however it was written. */
function isReciprocalOfVar(n: Node, v: string): boolean {
  if (n.t === 'var' && n.name === v) return true;
  if (n.t === '^' && n.a.t === 'var' && n.a.name === v && isNum(n.b) && n.b.v.d === 1n && n.b.v.n === -1n) {
    return true;
  }
  return false;
}

/**
 * Indefinite integral of an expression in a single variable.
 * Returns null when the integrand is outside the supported rule set, which
 * tells the caller to escalate to the AI solver instead of guessing.
 */
export function integrate(n: Node, v: string): IndefiniteResult | null {
  const rules: string[] = [];
  const x = VAR(v);
  const node = simplify(n);

  // Constant multiple of a recognised shape.
  if (node.t === '*') {
    const parts: Node[] = [node.a, node.b];
    for (let i = 0; i < parts.length; i++) {
      const other = parts[1 - i]!;
      const isNumPart = isNum(parts[i]!);
      if (!isNumPart) continue;
      const inner = integrate(other, v);
      if (inner) {
        rules.unshift('constant multiple', ...inner.rules);
        return { antiderivative: simplify(MUL(parts[i]!, inner.antiderivative)), hasConstant: true, rules };
      }
    }
  }

  // Sum rule
  if (node.t === '+' || node.t === '-') {
    const a = integrate(node.a, v);
    const b = integrate(node.b, v);
    if (a && b) {
      rules.push(node.t === '+' ? 'sum rule' : 'difference rule');
      return {
        antiderivative: simplify(node.t === '+' ? ADD(a.antiderivative, b.antiderivative) : SUB(a.antiderivative, b.antiderivative)),
        hasConstant: true,
        rules,
      };
    }
    if (a) return { antiderivative: simplify(ADD(a.antiderivative, node.b)), hasConstant: true, rules: [...a.rules, 'sum rule'] };
    if (b) return { antiderivative: simplify(ADD(node.a, b.antiderivative)), hasConstant: true, rules: [...b.rules, 'sum rule'] };
    return null;
  }

  if (node.t === 'neg') {
    const inner = integrate(node.a, v);
    if (inner) return { antiderivative: simplify(NEG(inner.antiderivative)), hasConstant: true, rules: ['minus rule', ...inner.rules] };
    return null;
  }

  // Linear power: x^n -> x^(n+1)/(n+1)
  if (node.t === '^' && node.a.t === 'var' && node.a.name === v && isNum(node.b)) {
    const e = node.b.v;
    // n = -1 is the reciprocal, whose antiderivative is a logarithm.
    if (e.d === 1n && e.n === -1n) {
      return { antiderivative: lnAbs(x), hasConstant: true, rules: ['1/x rule'] };
    }
    const next = NUM(rat(e.n + e.d, e.d));
    return {
      antiderivative: simplify(DIV(POW(x, next), next)),
      hasConstant: true,
      rules: ['power rule'],
    };
  }

  // 1/x, written as a division rather than a negative power.
  if (node.t === '/') {
    if (isReciprocalOfVar(node.b, v)) {
      return { antiderivative: lnAbs(x), hasConstant: true, rules: ['1/x rule'] };
    }
  }

  // Constant
  if (isNum(node) || node.t === 'const') {
    if (node.t === 'const') {
      const c = node.name === 'pi' ? rat(Math.PI) : rat(Math.E);
      return { antiderivative: simplify(MUL(node, x)), hasConstant: true, rules: ['constant rule'] };
    }
    return { antiderivative: simplify(MUL(node, x)), hasConstant: true, rules: ['constant rule'] };
  }

  // exp(kx)
  if (node.t === 'fn' && node.name === 'exp') {
    const inner = node.args[0]!;
    const k = linearCoefficient(inner, v);
    if (k !== null && k.n !== 0n) {
      return {
        antiderivative: simplify(DIV(node, NUM(k))),
        hasConstant: true,
        rules: ['exponential rule'],
      };
    }
    if (k !== null) {
      return { antiderivative: simplify(MUL(node, x)), hasConstant: true, rules: ['exponential rule'] };
    }
  }

  // sin(kx), cos(kx)
  if (node.t === 'fn' && (node.name === 'sin' || node.name === 'cos')) {
    const inner = node.args[0]!;
    const k = linearCoefficient(inner, v);
    if (k !== null && k.n !== 0n) {
      // The antiderivative swaps the function and absorbs the 1/k factor.
      const flipped = FN(node.name === 'sin' ? 'cos' : 'sin', [inner]);
      const oneOverK = NUM(rdiv(rat(1n), k));
      return {
        antiderivative: simplify(MUL(node.name === 'sin' ? NEG(flipped) : flipped, oneOverK)),
        hasConstant: true,
        rules: [`integral of ${node.name}(kx)`],
      };
    }
    if (k !== null) {
      const flipped = FN(node.name === 'sin' ? 'cos' : 'sin', [inner]);
      return {
        antiderivative: simplify(node.name === 'sin' ? NEG(flipped) : flipped),
        hasConstant: true,
        rules: [`integral of ${node.name}(x)`],
      };
    }
  }

  // 1 / (1 + x^2)  ->  arctan
  if (node.t === '/' && matchesInvOnePlusSquare(node.a, node.b, v)) {
    return { antiderivative: simplify(FN('atan', [x])), hasConstant: true, rules: ['arctangent rule'] };
  }
  // 1 / sqrt(1 - x^2) -> arcsin
  if (node.t === '/' && node.a.t === 'num' && node.a.v.n === 1n) {
    const b = node.b;
    if (b.t === 'fn' && b.name === 'sqrt') {
      const inner = b.args[0]!;
      if (inner.t === '-' && inner.a.t === 'num' && inner.a.v.n === 1n && inner.b.t === '^' && inner.b.a.t === 'var' && inner.b.a.name === v) {
        return { antiderivative: simplify(FN('asin', [x])), hasConstant: true, rules: ['arcsine rule'] };
      }
    }
  }

  // Polynomial
  const p = toPoly(node, v);
  if (p) {
    const deg = polyDegree(p);
    if (deg >= 0 && deg <= 64) {
      const out: Rational[] = [rat(0n)];
      // The antiderivative of a_i * v^i is a_i/(i+1) * v^(i+1), so each
      // coefficient shifts up one degree — hence the leading zero.
      for (let i = 0; i < p.length; i++) {
        out.push(rdiv(p[i]!, rat(BigInt(i + 1))));
      }
      return {
        antiderivative: simplify(polyToNode(out, v)),
        hasConstant: true,
        rules: ['power rule'],
      };
    }
  }

  return null;
}

/** If `inner` is k*v with k rational, return k. */
function linearCoefficient(inner: Node, v: string): Rational | null {
  const p = toPoly(inner, v);
  if (!p || polyDegree(p) > 1) return null;
  if (p.length === 1) return p[0]!;
  return p[1] ?? null;
}

function matchesInvOnePlusSquare(numNode: Node, denNode: Node, v: string): boolean {
  if (!(numNode.t === 'num' && numNode.v.d === 1n && numNode.v.n === 1n)) return false;
  if (denNode.t !== '+') return false;
  const ok = (term: Node): boolean =>
    (term.t === 'num' && term.v.d === 1n && term.v.n === 1n) ||
    (term.t === '^' && term.a.t === 'var' && term.a.name === v && isNum(term.b) && term.b.v.d === 1n && term.b.v.n === 2n);
  return ok(denNode.a) && ok(denNode.b);
}

export interface DefiniteResult {
  /** Exact rational value when the antiderivative could be evaluated exactly. */
  exact: Rational | null;
  /** Floating point value, always present. */
  numeric: number;
  antiderivative: Node | null;
  /** Simpson-based numeric integration was needed. */
  usedNumericFallback: boolean;
}

/** Adaptive Simpson integration, used when no exact antiderivative exists. */
export function numericIntegrate(f: (x: number) => number, a: number, b: number, tol = 1e-10): number {
  const sign = b < a ? -1 : 1;
  const [lo, hi] = b < a ? [b, a] : [a, b];
  const simpson = (l: number, r: number, fl: number, fm: number, fr: number): number =>
    ((r - l) / 6) * (fl + 4 * fm + fr);
  const recurse = (l: number, r: number, fl: number, fm: number, fr: number, whole: number, depth: number): number => {
    const mid = (l + r) / 2;
    const lm = (l + mid) / 2;
    const rm = (mid + r) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(l, mid, fl, flm, fm);
    const right = simpson(mid, r, fm, frm, fr);
    const delta = left + right - whole;
    if (depth <= 0 || Math.abs(delta) <= 15 * tol) return left + right + delta / 15;
    return (
      recurse(l, mid, fl, flm, fm, left, depth - 1) + recurse(mid, r, fm, frm, fr, right, depth - 1)
    );
  };
  const fl = f(lo);
  const fm = f((lo + hi) / 2);
  const fr = f(hi);
  const whole = simpson(lo, hi, fl, fm, fr);
  return sign * recurse(lo, hi, fl, fm, fr, whole, 40);
}

export function definiteIntegrate(n: Node, v: string, lower: number, upper: number): DefiniteResult {
  const ind = integrate(n, v);
  if (ind) {
    const F = ind.antiderivative;
    try {
      const hi = evaluate(F, { [v]: upper });
      const lo = evaluate(F, { [v]: lower });
      const val = hi - lo;
      if (Number.isFinite(val)) {
        let exact: Rational | null = null;
        try {
          exact = subtract(evalExact(F, v, rat(upper)), evalExact(F, v, rat(lower)));
        } catch {
          exact = null;
        }
        return { exact, numeric: val, antiderivative: F, usedNumericFallback: exact === null };
      }
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
    }
  }
  const numeric = numericIntegrate((x) => {
    try {
      return evaluate(n, { [v]: x });
    } catch {
      return 0;
    }
  }, lower, upper);
  return { exact: null, numeric, antiderivative: ind?.antiderivative ?? null, usedNumericFallback: true };
}

function evalExact(n: Node, v: string, x: Rational): Rational {
  // Exact evaluation with a rational value bound to `v`.
  const substituted = substitute(n, v, NUM(x));
  return evaluateExact(simplify(expand(substituted)));
}

function subtract(a: Rational, b: Rational): Rational {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}

/** Replace every occurrence of `v` with `replacement`. */
export function substitute(n: Node, v: string, replacement: Node): Node {
  switch (n.t) {
    case 'var':
      return n.name === v ? replacement : n;
    case 'num':
    case 'const':
      return n;
    case 'fn':
      return { t: 'fn', name: n.name, args: n.args.map((a) => substitute(a, v, replacement)) };
    case 'eq':
      return { t: 'eq', a: substitute(n.a, v, replacement), b: substitute(n.b, v, replacement) };
    case 'cmp':
      return { t: 'cmp', op: n.op, a: substitute(n.a, v, replacement), b: substitute(n.b, v, replacement) };
    case 'neg':
      return NEG(substitute(n.a, v, replacement));
    default:
      return { t: n.t, a: substitute(n.a, v, replacement), b: substitute(n.b, v, replacement) };
  }
}

export { toNumber };

