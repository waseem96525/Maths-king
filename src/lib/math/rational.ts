/**
 * Exact rational arithmetic on BigInt.
 *
 * Every arithmetic answer in this app flows through here, so a student who
 * types `1/3 + 1/6` gets `1/2` instead of `0.5000000000000001`, and `0.1 + 0.2`
 * gets exactly `3/10`. This is what makes the local solver trustworthy enough
 * to be treated as a source of truth by the verification engine.
 */

const GCD_CACHE = new Map<string, bigint>();

function bgcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  const key = `${a}|${b}`;
  const hit = GCD_CACHE.get(key);
  if (hit !== undefined) return hit;
  let x = a;
  let y = b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  if (GCD_CACHE.size < 4096) GCD_CACHE.set(key, x);
  return x;
}

export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

export function gcd(a: bigint, b: bigint): bigint {
  return bgcd(a, b);
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const g = bgcd(a, b);
  return (a / g) * (b < 0n ? -b : b);
}

/** Build a normalised rational (denominator always positive and > 0). */
export function rat(n: bigint | number | string | Rational, d: bigint | number | string | Rational = 1n): Rational {
  let nn: bigint;
  let dd: bigint;
  if (typeof n === 'object' && n !== null) {
    nn = n.n * (typeof d === 'object' ? d.d : BigInt(d as number | string));
    dd = n.d * (typeof d === 'object' ? d.n : BigInt(d as number | string));
  } else {
    nn = BigInt(n as bigint | number | string);
    dd = BigInt(d as bigint | number | string);
  }
  if (dd === 0n) throw new DivisionByZeroError();
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = bgcd(nn, dd);
  if (g > 1n) {
    nn /= g;
    dd /= g;
  }
  return { n: nn, d: dd };
}

export class DivisionByZeroError extends Error {
  constructor() {
    super('Division by zero');
    this.name = 'DivisionByZeroError';
  }
}

export const R0: Rational = { n: 0n, d: 1n };
export const R1: Rational = { n: 1n, d: 1n };
export const R2: Rational = { n: 2n, d: 1n };

export const isZero = (a: Rational): boolean => a.n === 0n;
export const isOne = (a: Rational): boolean => a.n === a.d;
export const isNeg = (a: Rational): boolean => a.n < 0n;
export const isInt = (a: Rational): boolean => a.d === 1n;
export const sign = (a: Rational): -1 | 0 | 1 => (a.n === 0n ? 0 : a.n < 0n ? -1 : 1);

/**
 * Canonicalise a raw numerator/denominator pair: flip a negative denominator
 * onto the numerator and reduce by the gcd. Every operation below funnels
 * through this so no negative denominator can ever escape, which is what keeps
 * `isInt`, formatting, and determinant sign checks trustworthy.
 */
function norm(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new DivisionByZeroError();
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bgcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

export const radd = (a: Rational, b: Rational): Rational => {
  if (a.n === 0n) return b;
  if (b.n === 0n) return a;
  // The common denominator is lcm(a.d, b.d) = (a.d / g) * b.d — not
  // (a.d / g) * (b.d / g), which is smaller whenever g > 1.
  const g = bgcd(a.d, b.d);
  const ad = a.d / g;
  const bd = b.d / g;
  return norm(a.n * bd + b.n * ad, ad * b.d);
};

export const rsub = (a: Rational, b: Rational): Rational => {
  if (b.n === 0n) return a;
  return radd(a, { n: -b.n, d: b.d });
};

export const rneg = (a: Rational): Rational => (a.n === 0n ? a : { n: -a.n, d: a.d });

export const rmul = (a: Rational, b: Rational): Rational => {
  if (a.n === 0n || b.n === 0n) return R0;
  if (a.n === 1n && a.d === 1n) return b;
  if (b.n === 1n && b.d === 1n) return a;
  // Cross-cancel before multiplying to keep bigint sizes down.
  const g1 = bgcd(a.n, b.d);
  const g2 = bgcd(b.n, a.d);
  return norm((a.n / g1) * (b.n / g2), (a.d / g2) * (b.d / g1));
};

export const rdiv = (a: Rational, b: Rational): Rational => {
  if (b.n === 0n) throw new DivisionByZeroError();
  return rmul(a, norm(b.d, b.n));
};

export const rinv = (a: Rational): Rational => {
  if (a.n === 0n) throw new DivisionByZeroError();
  return { n: a.d, d: a.n };
};

export const rabs = (a: Rational): Rational => (a.n < 0n ? rneg(a) : a);

export const rcmp = (a: Rational, b: Rational): -1 | 0 | 1 => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

export const req = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;

/** Integer exponentiation. Negative exponents are supported. */
export const rpow = (a: Rational, e: bigint): Rational => {
  if (e === 0n) return R1;
  if (e < 0n) return rpow(rinv(a), -e);
  let result = R1;
  let base = a;
  let k = e;
  while (k > 0n) {
    if (k & 1n) result = rmul(result, base);
    base = rmul(base, base);
    k >>= 1n;
  }
  return result;
};

export const rsqrt = (a: Rational): Rational => {
  if (a.n < 0n) throw new Error('Square root of a negative rational');
  const rn = bigintSqrt(a.n);
  const rd = bigintSqrt(a.d);
  if (rn * rn === a.n && rd * rd === a.d && rd !== 0n) return rat(rn, rd);
  return rat(fromNumber(Math.sqrt(toNumber(a))));
};

export function isPerfectSquare(n: bigint): boolean {
  if (n < 0n) return false;
  return bigintSqrt(n) ** 2n === n;
}

export function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('bigintSqrt of negative');
  if (n < 2n) return n;
  // Newton's method — converges quadratically.
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x;
}

export function toNumber(a: Rational): number {
  if (a.d === 1n) return Number(a.n);
  return Number(a.n) / Number(a.d);
}

export function fromNumber(x: number): Rational {
  if (!Number.isFinite(x)) throw new Error(`Cannot convert ${x} to an exact rational`);
  if (Number.isInteger(x)) return { n: BigInt(x), d: 1n };
  return fromDecimalString(String(x));
}

/**
 * Exact conversion of a decimal literal such as "0.1" or "1.25".
 * Keeps the literal digits rather than the binary double, so 0.1 becomes 1/10.
 */
export function fromDecimalString(s: string): Rational {
  const t = s.trim();
  if (!t) throw new Error('Cannot convert an empty string to a rational');
  if (/^[+-]?\d+$/.test(t)) return { n: BigInt(t), d: 1n };
  const neg = t.startsWith('-');
  const body = neg || t.startsWith('+') ? t.slice(1) : t;
  if (body.includes('e') || body.includes('E')) {
    const [mantissa, expPart] = body.split(/[eE]/);
    const exponent = Number(expPart);
    const digits = mantissa.replace('.', '');
    const r = rat(digits, 1n);
    return exponent < 0 ? rdiv(r, rat(10n ** BigInt(-exponent))) : rmul(r, rat(10n ** BigInt(exponent)));
  }
  const [ip, fp = ''] = body.split('.');
  const r = rat(`${ip || '0'}${fp}`, 10n ** BigInt(fp.length));
  return neg ? rneg(r) : r;
}

/** Nearest integer, ties away from zero. */
export function roundRat(a: Rational): bigint {
  const twice = a.n * 2n;
  const q = twice >= 0n ? (twice + a.d) / (2n * a.d) : -((-twice + a.d) / (2n * a.d));
  return q;
}

export function floorRat(a: Rational): bigint {
  const q = a.n / a.d;
  return a.n < 0n && q * a.d !== a.n ? q - 1n : q;
}

export function ceilRat(a: Rational): bigint {
  const q = a.n / a.d;
  return a.n > 0n && q * a.d !== a.n ? q + 1n : q;
}

/** Plain (unsimplified) decimal string, e.g. 0.5 for 1/2. */
export function toDecimalString(a: Rational, maxDigits = 10): string {
  if (a.d === 1n) return a.n.toString();
  const sign = a.n < 0n ? '-' : '';
  const abs = a.n < 0n ? -a.n : a.n;
  const intPart = abs / a.d;
  const rem = abs % a.d;
  let frac = '';
  let r = rem;
  for (let i = 0; i < maxDigits; i++) {
    r *= 10n;
    const digit = r / a.d;
    frac += digit.toString();
    r %= a.d;
    if (r === 0n) break;
  }
  // Trim a trailing repeating-9 artefact.
  frac = frac.replace(/9+$/, (m, off: number) => (off === 0 ? m : ''));
  if (!frac) return `${sign}${intPart}`;
  return `${sign}${intPart}.${frac.replace(/0+$/, '')}`;
}

export function toString(a: Rational): string {
  if (a.d === 1n) return a.n.toString();
  return `${a.n}/${a.d}`;
}

/** Human label used in step copy, e.g. "one half" stays symbolic, "3" stays "3". */
export function parseRatString(s: string): Rational | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(t);
  if (m) {
    const d = BigInt(m[2]!);
    if (d === 0n) return null;
    return rat(BigInt(m[1]!), d);
  }
  if (/^[+-]?\d+$/.test(t)) return rat(BigInt(t));
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return fromNumber(Number(t));
  return null;
}

export const RATIONAL_ZERO = R0;
