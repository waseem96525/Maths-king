import type { Node } from './ast';
import { DIV, MUL, NEG, NUM, POW, VAR, ADD, SUB, FN, CONST } from './ast';
import { isInt, rat, radd, rdiv, rmul, rneg, rsub, toNumber, type Rational } from './rational';

/** Coefficients are stored low-degree first: `2x^2 + 3x + 1` -> [1n, 3, 2]. */
export type Poly = Rational[];

export function polyTrim(p: Poly): Poly {
  let i = p.length - 1;
  while (i > 0 && p[i]!.n === 0n) i--;
  return p.slice(0, i + 1);
}

export function polyDegree(p: Poly): number {
  const t = polyTrim(p);
  return t.length - 1;
}

export function polyAdd(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    out.push(radd(a[i] ?? rat(0n), b[i] ?? rat(0n)));
  }
  return polyTrim(out);
}

export function polySub(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    out.push(rsub(a[i] ?? rat(0n), b[i] ?? rat(0n)));
  }
  return polyTrim(out);
}

export function polyMul(a: Poly, b: Poly): Poly {
  if (a.length === 0 || b.length === 0) return [rat(0n)];
  const out: Poly = new Array(a.length + b.length - 1).fill(rat(0n));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] = radd(out[i + j]!, rmul(a[i]!, b[j]!));
    }
  }
  return polyTrim(out);
}

export function polyScale(a: Poly, k: Rational): Poly {
  return polyTrim(a.map((c) => rmul(c, k)));
}

export function polyDivRem(a: Poly, b: Poly): { q: Poly; r: Poly } {
  const rem = polyTrim([...a]);
  const db = polyDegree(b);
  if (db < 0 || (b.length === 1 && b[0]!.n === 0n)) throw new Error('Polynomial division by zero');
  const q: Poly = new Array(Math.max(1, rem.length - db)).fill(rat(0n));
  const lead = b[db]!;
  for (;;) {
    const dr = polyDegree(rem);
    if (dr < db || rem.every((c) => c.n === 0n)) break;
    const factor = rdiv(rem[dr]!, lead);
    const shift = dr - db;
    q[shift] = radd(q[shift] ?? rat(0n), factor);
    for (let i = 0; i <= db; i++) {
      rem[i + shift] = rsub(rem[i + shift] ?? rat(0n), rmul(factor, b[i]!));
    }
  }
  return { q: polyTrim(q), r: polyTrim(rem) };
}

export function polyEval(p: Poly, x: Rational): Rational {
  // Horner's method, exact.
  let acc = rat(0n);
  for (let i = p.length - 1; i >= 0; i--) acc = radd(rmul(acc, x), p[i]!);
  return acc;
}

export function polyDeriv(p: Poly): Poly {
  if (p.length <= 1) return [rat(0n)];
  const out: Poly = [];
  for (let i = 1; i < p.length; i++) out.push(rmul(p[i]!, rat(BigInt(i))));
  return polyTrim(out);
}

export function polyToNode(p: Poly, v: string): Node {
  const t = polyTrim(p);
  if (t.length === 0) return NUM(rat(0n));
  const x = VAR(v);
  // Built in descending degree. Each coefficient's sign decides whether the
  // term is added or subtracted, and the magnitude always renders positive, so
  // `x^2 - 2x - 1` never comes back as `x^2 - (-2)x - 1`.
  let out: Node | null = null;
  for (let i = t.length - 1; i >= 0; i--) {
    const c = t[i]!;
    if (c.n === 0n) continue;
    const negative = c.n < 0n;
    const mag = negative ? rneg(c) : c;
    let term: Node;
    if (i === 0) {
      term = NUM(mag);
    } else if (i === 1) {
      term = ratEq(mag, rat(1n)) ? x : MUL(NUM(mag), x);
    } else {
      const power = POW(x, NUM(rat(BigInt(i))));
      term = ratEq(mag, rat(1n)) ? power : MUL(NUM(mag), power);
    }
    if (out === null) out = negative ? NEG(term) : term;
    else out = negative ? SUB(out, term) : ADD(out, term);
  }
  return out ?? NUM(rat(0n));
}

function absNode(n: Node): Node {
  return n.t === 'neg' ? n.a : n;
}

export function ratEq(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function isNegativeNode(n: Node): boolean {
  if (n.t === 'neg') return true;
  return n.t === 'num' && n.v.n < 0n;
}

/** Convert a node into polynomial form in `v`, or return null. */
export function toPoly(n: Node, v: string, depth = 0): Poly | null {
  if (depth > 64) return null;
  switch (n.t) {
    case 'num':
      return [n.v];
    case 'var':
      return n.name === v ? [rat(0n), rat(1n)] : [rat(0n)];
    case 'const':
      return null;
    case '+': {
      const a = toPoly(n.a, v, depth + 1);
      const b = toPoly(n.b, v, depth + 1);
      return a && b ? polyAdd(a, b) : null;
    }
    case '-': {
      const a = toPoly(n.a, v, depth + 1);
      const b = toPoly(n.b, v, depth + 1);
      return a && b ? polySub(a, b) : null;
    }
    case 'neg': {
      const a = toPoly(n.a, v, depth + 1);
      return a ? polyScale(a, rat(-1n)) : null;
    }
    case '*': {
      const a = toPoly(n.a, v, depth + 1);
      const b = toPoly(n.b, v, depth + 1);
      return a && b ? polyMul(a, b) : null;
    }
    case '/': {
      const a = toPoly(n.a, v, depth + 1);
      const b = toPoly(n.b, v, depth + 1);
      // Only a nonzero constant divides. A zero denominator has no inverse, so
      // `rat(1, 0)` would divide by zero; this is not a polynomial, it is
      // undefined.
      if (!a || !b || polyDegree(b) !== 0 || b[0]!.n === 0n) return null;
      return polyScale(a, rat(b[0]!.d, b[0]!.n));
    }
    case '^': {
      const e = toPoly(n.b, v, depth + 1);
      if (!e || polyDegree(e) !== 0 || !isInt(e[0]!) || e[0]!.n < 0n) return null;
      const k = Number(e[0]!.n);
      if (k > 64) return null;
      const a = toPoly(n.a, v, depth + 1);
      if (!a) return null;
      let out: Poly = [rat(1n)];
      for (let i = 0; i < k; i++) out = polyMul(out, a);
      return out;
    }
    case 'fn':
      if (n.name === 'abs' && n.args[0]!.t === 'num') return [rat(n.args[0]!.v.n < 0n ? -1n : 1n)];
      return null;
    default:
      return null;
  }
}

export function polyGcd(a: Poly, b: Poly): Poly {
  let x = polyTrim([...a]);
  let y = polyTrim([...b]);
  if (x.every((c) => c.n === 0n)) return polyTrim([...y]);
  if (y.every((c) => c.n === 0n)) return polyTrim([...x]);
  while (!y.every((c) => c.n === 0n)) {
    const { r } = polyDivRem(x, y);
    x = y;
    y = r;
  }
  if (x.length === 0) return [rat(1n)];
  const lead = x[x.length - 1]!;
  return polyScale(x, rat(lead.d, lead.n));
}

/** Integer roots of a polynomial, found with the rational root theorem. */
export function integerRoots(p: Poly): Rational[] {
  const t = polyTrim(p);
  if (t.length <= 1) return [];
  const a0 = t[0]!;
  const an = t[t.length - 1]!;
  const constDiv = divisors(a0.n < 0n ? -a0.n : a0.n);
  const leadDiv = divisors(an.n < 0n ? -an.n : an.n);
  const out: Rational[] = [];
  const seen = new Set<string>();
  for (const p1 of constDiv) {
    for (const q1 of leadDiv) {
      for (const s of [1n, -1n]) {
        const cand = rat(s * p1, q1);
        const key = `${cand.n}/${cand.d}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (polyEval(t, cand).n === 0n) out.push(cand);
      }
    }
  }
  return out;
}

export function divisors(n: bigint): bigint[] {
  if (n === 0n) return [1n];
  const out: bigint[] = [];
  let i = 1n;
  const nn = n < 0n ? -n : n;
  while (i * i <= nn) {
    if (nn % i === 0n) {
      out.push(i);
      if (i !== nn / i) out.push(nn / i);
    }
    i++;
    if (i > 5000n) break;
  }
  return out;
}

export function polyToString(p: Poly, v: string): string {
  const t = polyTrim(p);
  if (t.length === 1) return String(toNumber(t[0]!));
  return t.map((c, i) => (i === 0 ? String(toNumber(c)) : `${toNumber(c)}*${v}^${i}`)).join(' + ');
}

export { DIV, MUL, NEG, NUM, POW, VAR, FN, CONST, isInt };
