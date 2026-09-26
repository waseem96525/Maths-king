import type { FnName, Node } from './ast';
import { isReservedName } from './latex';
import {
  DivisionByZeroError,
  type Rational,
  fromNumber,
  gcd,
  lcm,
  rat,
  rabs,
  radd,
  rdiv,
  rinv,
  rmul,
  rneg,
  rsqrt,
  rsub,
  toNumber,
} from './rational';

export type Env = Record<string, number>;

export class MathError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'division_by_zero'
      | 'domain'
      | 'not_a_number'
      | 'unknown_symbol'
      | 'unsupported'
      | 'irrational'
      | 'overflow',
  ) {
    super(message);
    this.name = 'MathError';
  }
}

/**
 * The only rational values `sin` can take at a rational multiple of pi are
 * 0, ±1/2 and ±1 (Niven's theorem); for `tan` only 0 and ±1. So rather than
 * carrying a table of special angles, the float result is checked against
 * exactly those candidates. Anything else — `sin(45°)`, `sin(1°)` — is
 * genuinely irrational and is declined, which is what keeps the exact
 * evaluator honest instead of dressing a float up as a fraction.
 */
const NIVEAN_TOLERANCE = 1e-9;

function nearestNiven(value: number, allowed: readonly Rational[]): Rational | null {
  for (const candidate of allowed) {
    for (const signed of candidate.n === 0n ? [candidate] : [candidate, rneg(candidate)]) {
      if (Math.abs(value - toNumber(signed)) < NIVEAN_TOLERANCE) return signed;
    }
  }
  return null;
}

/**
 * Exact values for the trigonometric functions, or null when the result is
 * irrational. Only sin/cos/tan qualify; their inverses return angles, which are
 * multiples of pi rather than rational numbers.
 */
function exactTrig(name: FnName, arg: Node, env: Env): Rational | null {
  if (name !== 'sin' && name !== 'cos' && name !== 'tan') return null;
  const value = applyFn(name, [evaluate(arg, env)]);
  if (!Number.isFinite(value)) return null;
  // 0, ±1/2, ±1 for sin/cos; 0 and ±1 for tan.
  return name === 'tan'
    ? nearestNiven(value, [rat(0n), rat(1n)])
    : nearestNiven(value, [rat(0n), rat(1n, 2n), rat(1n)]);
}

const FACT_CACHE = [1n, 1n, 2n];

function factorialBig(n: bigint): bigint {
  if (n < 0n) throw new MathError('Factorial is only defined for non-negative whole numbers', 'domain');
  if (n > 5000n) throw new MathError('That factorial is too large to compute exactly', 'overflow');
  if (n < 3n) return 1n;
  const idx = Number(n);
  if (idx < FACT_CACHE.length) return FACT_CACHE[idx]!;
  let acc = FACT_CACHE[FACT_CACHE.length - 1]!;
  for (let k = BigInt(FACT_CACHE.length); k <= n; k++) acc *= k;
  if (FACT_CACHE.length < 200) FACT_CACHE.push(acc);
  return acc;
}

function combinations(n: bigint, r: bigint): bigint {
  if (r < 0n || n < 0n) throw new MathError('Combinations need non-negative whole numbers', 'domain');
  if (r > n) return 0n;
  const k = r < n - r ? r : n - r;
  let acc = 1n;
  for (let i = 0n; i < k; i++) acc = (acc * (n - i)) / (i + 1n);
  return acc;
}

function permutations(n: bigint, r: bigint): bigint {
  if (r < 0n || n < 0n) throw new MathError('Permutations need non-negative whole numbers', 'domain');
  if (r > n) return 0n;
  let acc = 1n;
  for (let i = 0n; i < r; i++) acc *= n - i;
  return acc;
}

function applyFn(name: string, args: number[]): number {
  switch (name) {
    case 'sin':
      return Math.sin(args[0]!);
    case 'cos':
      return Math.cos(args[0]!);
    case 'tan':
      return Math.tan(args[0]!);
    case 'asin': {
      const v = args[0]!;
      if (v < -1 || v > 1) throw new MathError('sin⁻¹ is only defined for values between -1 and 1', 'domain');
      return Math.asin(v);
    }
    case 'acos': {
      const v = args[0]!;
      if (v < -1 || v > 1) throw new MathError('cos⁻¹ is only defined for values between -1 and 1', 'domain');
      return Math.acos(v);
    }
    case 'atan':
      return Math.atan(args[0]!);
    case 'sinh':
      return Math.sinh(args[0]!);
    case 'cosh':
      return Math.cosh(args[0]!);
    case 'tanh':
      return Math.tanh(args[0]!);
    case 'sqrt': {
      const v = args[0]!;
      if (v < 0) throw new MathError('Cannot take the square root of a negative number', 'domain');
      return Math.sqrt(v);
    }
    case 'cbrt':
      return Math.cbrt(args[0]!);
    case 'abs':
      return Math.abs(args[0]!);
    case 'ln': {
      const v = args[0]!;
      if (v <= 0) throw new MathError('ln is only defined for positive numbers', 'domain');
      return Math.log(v);
    }
    case 'log': {
      const v = args.length === 2 ? args[1]! : args[0]!;
      if (v <= 0) throw new MathError('log is only defined for positive numbers', 'domain');
      return args.length === 2 ? Math.log(v) / Math.log(args[0]!) : Math.log10(v);
    }
    case 'logb': {
      if (args[0]! <= 0 || args[1]! <= 0) throw new MathError('log is only defined for positive numbers', 'domain');
      return Math.log(args[1]!) / Math.log(args[0]!);
    }
    case 'log2':
      return Math.log2(args[0]!);
    case 'exp':
      return Math.exp(args[0]!);
    case 'floor':
      return Math.floor(args[0]!);
    case 'ceil':
      return Math.ceil(args[0]!);
    case 'round':
      return Math.round(args[0]!);
    case 'sign':
      return Math.sign(args[0]!);
    case 'min':
      return Math.min(...args);
    case 'max':
      return Math.max(...args);
    case 'hypot':
      return Math.hypot(...args);
    case 'gcd':
      return toNumber(rat(gcd(toInt(args[0]!), toInt(args[1]!))));
    case 'lcm':
      return toNumber(rat(lcm(toInt(args[0]!), toInt(args[1]!))));
    case 'fact':
      return toNumber(rat(factorialBig(toInt(args[0]!))));
    case 'comb':
      return toNumber(rat(combinations(toInt(args[0]!), toInt(args[1]!))));
    case 'perm':
      return toNumber(rat(permutations(toInt(args[0]!), toInt(args[1]!))));
    case 'mod':
      if (args[1] === 0) throw new MathError('Cannot take a remainder with a divisor of zero', 'division_by_zero');
      return args[0]! % args[1]!;
    case 'deg':
      return (args[0]! * 180) / Math.PI;
    case 'rad':
      return (args[0]! * Math.PI) / 180;
    default:
      throw new MathError(`Unsupported function "${name}"`, 'unsupported');
  }
}

/** Whole-number argument for the combinatorial functions. */
function toInt(x: number): bigint {
  if (!Number.isFinite(x)) throw new MathError('Expected a whole number', 'domain');
  const r = Math.round(x);
  if (Math.abs(x - r) > 1e-9) throw new MathError('Expected a whole number', 'domain');
  return BigInt(r);
}

export function evaluate(n: Node, env: Env = {}): number {
  switch (n.t) {
    case 'num':
      return toNumber(n.v);
    case 'const':
      return n.name === 'pi' ? Math.PI : Math.E;
    case 'var': {
      const v = env[n.name];
      if (v === undefined) {
        if (isReservedName(n.name)) {
          throw new MathError(`"${n.name}" needs a value before it can be evaluated`, 'unknown_symbol');
        }
        throw new MathError(`Unknown symbol "${n.name}"`, 'unknown_symbol');
      }
      if (!Number.isFinite(v)) throw new MathError(`"${n.name}" has no finite value here`, 'not_a_number');
      return v;
    }
    case '+':
      return evaluate(n.a, env) + evaluate(n.b, env);
    case '-':
      return evaluate(n.a, env) - evaluate(n.b, env);
    case '*':
      return evaluate(n.a, env) * evaluate(n.b, env);
    case '/': {
      const d = evaluate(n.b, env);
      if (d === 0) throw new MathError('Division by zero is undefined', 'division_by_zero');
      return evaluate(n.a, env) / d;
    }
    case 'neg':
      return -evaluate(n.a, env);
    case '^': {
      const base = evaluate(n.a, env);
      const exp = evaluate(n.b, env);
      if (base < 0 && !Number.isInteger(exp)) {
        throw new MathError('A negative number cannot be raised to a fractional power', 'domain');
      }
      const v = Math.pow(base, exp);
      if (!Number.isFinite(v)) throw new MathError('That result is too large to represent', 'overflow');
      return v;
    }
    case 'fn': {
      const args = n.args.map((a) => evaluate(a, env));
      return applyFn(n.name, args);
    }
    case 'eq':
      throw new MathError('An equation has no single numeric value — solve it instead', 'unsupported');
    case 'cmp':
      throw new MathError('An inequality has no single numeric value — solve it instead', 'unsupported');
    default: {
      const never: never = n;
      throw new MathError(`Unsupported expression ${JSON.stringify(never)}`, 'unsupported');
    }
  }
}

/**
 * Exact rational evaluation. Throws when the expression genuinely needs
 * irrational or transcendental arithmetic, so callers can fall back to
 * floating point and label the answer as approximate.
 */
export function evaluateExact(n: Node, env: Env = {}): Rational {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'const':
      throw new MathError('This constant is not a rational number', 'domain');
    case 'var': {
      const v = env[n.name];
      if (v === undefined) throw new MathError(`Unknown symbol "${n.name}"`, 'unknown_symbol');
      return fromNumber(v);
    }
    case '+':
      return radd(evaluateExact(n.a, env), evaluateExact(n.b, env));
    case '-':
      return rsub(evaluateExact(n.a, env), evaluateExact(n.b, env));
    case '*':
      return rmul(evaluateExact(n.a, env), evaluateExact(n.b, env));
    case '/': {
      const d = evaluateExact(n.b, env);
      if (d.n === 0n) throw new MathError('Division by zero is undefined', 'division_by_zero');
      return rdiv(evaluateExact(n.a, env), d);
    }
    case 'neg':
      return rneg(evaluateExact(n.a, env));
    case '^': {
      const b = evaluateExact(n.a, env);
      const e = evaluateExact(n.b, env);
      if (e.d !== 1n) {
        // A fractional power is rational only in special cases (sqrt of a
        // perfect square and the like). Reporting a float-derived fraction
        // would claim an exactness this does not have, so decline instead.
        throw new MathError('This power is not a rational number', 'irrational');
      }
      const exp = e.n;
      let out = rat(1n);
      let acc = b;
      let k = exp < 0n ? -exp : exp;
      while (k > 0n) {
        if (k & 1n) out = rmul(out, acc);
        acc = rmul(acc, acc);
        k >>= 1n;
      }
      return exp < 0n ? rinv(out) : out;
    }
    case 'fn': {
      const name = n.name;
      if (name === 'abs') return rabs(evaluateExact(n.args[0]!, env));
      if (name === 'sqrt') return rsqrt(evaluateExact(n.args[0]!, env));
      if (name === 'floor' || name === 'ceil' || name === 'round') {
        const v = evaluateExact(n.args[0]!, env);
        return rat(name === 'floor' ? floorOf(v) : name === 'ceil' ? ceilOf(v) : roundOf(v));
      }
      if (name === 'sign') {
        const v = evaluateExact(n.args[0]!, env);
        return rat(v.n === 0n ? 0 : v.n > 0n ? 1 : -1);
      }
      if (name === 'fact') return rat(factorialBig(evaluateExact(n.args[0]!, env).n));
      if (name === 'gcd') {
        const a = evaluateExact(n.args[0]!, env);
        const b = evaluateExact(n.args[1]!, env);
        return rat(gcd(a.n, b.n));
      }
      if (name === 'lcm') {
        const a = evaluateExact(n.args[0]!, env);
        const b = evaluateExact(n.args[1]!, env);
        return rat(lcm(a.n, b.n));
      }
      if (name === 'comb') {
        const a = evaluateExact(n.args[0]!, env);
        const b = evaluateExact(n.args[1]!, env);
        return rat(combinations(a.n, b.n));
      }
      if (name === 'perm') {
        const a = evaluateExact(n.args[0]!, env);
        const b = evaluateExact(n.args[1]!, env);
        return rat(permutations(a.n, b.n));
      }
      if (name === 'min' || name === 'max') {
        const vals = n.args.map((a) => evaluateExact(a, env));
        const pick = name === 'min' ? vals.reduce((x, y) => (x.n * y.d < y.n * x.d ? x : y)) : vals.reduce((x, y) => (x.n * y.d > y.n * x.d ? x : y));
        return pick;
      }
      if (name === 'mod') {
        const a = evaluateExact(n.args[0]!, env);
        const b = evaluateExact(n.args[1]!, env);
        if (b.n === 0n) throw new MathError('Cannot take a remainder with a divisor of zero', 'division_by_zero');
        return rsub(a, rmul(b, rat(floorOf(rdiv(a, b)))));
      }
      // Transcendental functions have no rational value in general. Rather than
      // laundering a float through `fromNumber` — which would report 0.4999...
      // as the exact fraction 24999999999999997/50000000000000000 — the exact
      // cases are recognised and everything else is declined.
      const exact = exactTrig(name, n.args[0]!, env);
      if (exact) return exact;
      throw new MathError(`\`${name}\` has no exact rational value here`, 'irrational');
    }
    default:
      throw new MathError('This expression has no exact value', 'unsupported');
  }
}

function floorOf(v: Rational): bigint {
  const q = v.n / v.d;
  return v.n < 0n && q * v.d !== v.n ? q - 1n : q;
}
function ceilOf(v: Rational): bigint {
  const q = v.n / v.d;
  return v.n > 0n && q * v.d !== v.n ? q + 1n : q;
}
function roundOf(v: Rational): bigint {
  return floorOf(radd(v, rat(1n, 2n)));
}

/** True when the node contains no free variables. */
export function isConstantNode(n: Node): boolean {
  switch (n.t) {
    case 'num':
    case 'const':
      return true;
    case 'var':
      return false;
    case 'eq':
    case 'cmp':
      return isConstantNode(n.a) && isConstantNode(n.b);
    case 'neg':
      return isConstantNode(n.a);
    case 'fn':
      return n.args.every(isConstantNode);
    default:
      return isConstantNode(n.a) && isConstantNode(n.b);
  }
}

export function collectVars(n: Node, out: Set<string> = new Set()): Set<string> {
  switch (n.t) {
    case 'var':
      out.add(n.name);
      break;
    case 'num':
    case 'const':
      break;
    default: {
      if ('a' in n) collectVars(n.a, out);
      if ('b' in n) collectVars(n.b, out);
      if (n.t === 'fn') for (const arg of n.args) collectVars(arg, out);
    }
  }
  return out;
}

export function tryEvaluate(n: Node, env: Env = {}): number | null {
  try {
    const v = evaluate(n, env);
    return Number.isFinite(v) ? v : null;
  } catch (err) {
    if (err instanceof DivisionByZeroError) return null;
    return null;
  }
}

export function tryEvaluateExact(n: Node, env: Env = {}): Rational | null {
  try {
    return evaluateExact(n, env);
  } catch {
    return null;
  }
}
