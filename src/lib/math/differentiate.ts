import { ADD, CONST, DIV, FN, MUL, NEG, NUM, POW, SUB, VAR, type Node, isNum } from './ast';
import { rat, toNumber } from './rational';
import { simplify, expand } from './simplify';

/** Symbolic differentiation. Returns a simplified node (never throws). */
export function differentiate(n: Node, v: string, depth = 0): Node {
  if (depth > 48) return NUM(rat(0n));
  const x = VAR(v);
  const one = NUM(rat(1n));
  switch (n.t) {
    case 'num':
    case 'const':
      return NUM(rat(0n));
    case 'var':
      return n.name === v ? one : NUM(rat(0n));
    case '+':
      return tidy(ADD(differentiate(n.a, v, depth + 1), differentiate(n.b, v, depth + 1)), v);
    case '-':
      return tidy(SUB(differentiate(n.a, v, depth + 1), differentiate(n.b, v, depth + 1)), v);
    case 'neg':
      return tidy(NEG(differentiate(n.a, v, depth + 1)), v);
    case '*':
      return tidy(
        ADD(MUL(differentiate(n.a, v, depth + 1), n.b), MUL(n.a, differentiate(n.b, v, depth + 1))),
        v,
      );
    case '/': {
      const q = POW(n.b, NUM(rat(2n)));
      return tidy(
        DIV(SUB(MUL(differentiate(n.a, v, depth + 1), n.b), MUL(n.a, differentiate(n.b, v, depth + 1))), q),
        v,
      );
    }
    case '^': {
      const da = differentiate(n.a, v, depth + 1);
      const db = differentiate(n.b, v, depth + 1);
      // Constant exponent -> power rule: k * a^(k-1) * a'
      if (isNum(n.b)) {
        const k = n.b.v;
        if (k.d === 1n) {
          if (k.n === 0n) return zeroNode();
          // A negative exponent is cleaner as 1/a^|k-1| than as a^-1 * a^-2.
          if (k.n < 0n) {
            const flipped = POW(n.a, NUM(rat(1n - k.n)));
            const scaled = simplify(MUL(NUM(k), DIV(NUM(rat(1n)), flipped)));
            return tidy(simplify(MUL(scaled, da)), v);
          }
          return tidy(MUL(MUL(NUM(k), POW(n.a, NUM(rat(k.n - 1n)))), da), v);
        }
        // Rational exponent -> a^b * ln(a) * b' is wrong here (b is constant),
        // so fall through to the general variable-exponent rule.
        if (da.t === 'num' && da.v.n === 0n) return zeroNode();
      }
      // Constant base -> a^b * ln(a) * b'
      if (da.t === 'num' && da.v.n === 0n) {
        return tidy(MUL(MUL(n, FN('ln', [n.a])), db), v);
      }
      // General case -> a^b * (b' ln a + b a'/a)
      return tidy(MUL(n, ADD(MUL(db, FN('ln', [n.a])), DIV(MUL(n.b, da), n.a))), v);
    }
    case 'fn': {
      const u = n.args[0]!;
      const du = differentiate(u, v, depth + 1);
      const zero = du.t === 'num' && du.v.n === 0n;
      switch (n.name) {
        case 'sin':
          return zero ? zeroNode() : tidy(MUL(FN('cos', [u]), du), v);
        case 'cos':
          return zero ? zeroNode() : tidy(NEG(MUL(FN('sin', [u]), du)), v);
        case 'tan':
          return zero ? zeroNode() : tidy(DIV(du, MUL(FN('cos', [u]), FN('cos', [u]))), v);
        case 'asin':
          return zero ? zeroNode() : tidy(DIV(du, FN('sqrt', [SUB(one, POW(u, NUM(rat(2n))))])), v);
        case 'acos':
          return zero
            ? zeroNode()
            : tidy(NEG(DIV(du, FN('sqrt', [SUB(one, POW(u, NUM(rat(2n))))]))), v);
        case 'atan':
          return zero ? zeroNode() : tidy(DIV(du, ADD(one, POW(u, NUM(rat(2n))))), v);
        case 'sinh':
          return zero ? zeroNode() : tidy(MUL(FN('cosh', [u]), du), v);
        case 'cosh':
          return zero ? zeroNode() : tidy(MUL(FN('sinh', [u]), du), v);
        case 'tanh':
          return zero ? zeroNode() : tidy(DIV(du, POW(FN('cosh', [u]), NUM(rat(2n)))), v);
        case 'exp':
          return zero ? zeroNode() : tidy(MUL(n, du), v);
        case 'ln':
          return zero ? zeroNode() : tidy(DIV(du, u), v);
        case 'log':
          return zero ? zeroNode() : tidy(DIV(du, MUL(u, FN('ln', [NUM(rat(10n))]))), v);
        case 'log2':
          return zero ? zeroNode() : tidy(DIV(du, MUL(u, FN('ln', [NUM(rat(2n))]))), v);
        case 'sqrt':
          return zero ? zeroNode() : tidy(DIV(du, MUL(NUM(rat(2n)), FN('sqrt', [u]))), v);
        case 'cbrt':
          return zero
            ? zeroNode()
            : tidy(DIV(du, MUL(NUM(rat(3n)), MUL(FN('cbrt', [u]), FN('cbrt', [u])))), v);
        case 'abs':
          return zero ? zeroNode() : tidy(MUL(n, DIV(du, u)), v);
        default:
          return zeroNode();
      }
    }
    case 'eq':
    case 'cmp':
      return zeroNode();
    default: {
      const never: never = n;
      return never;
    }
  }
}

function zeroNode(): Node {
  return NUM(rat(0n));
}

function tidy(n: Node, v: string): Node {
  try {
    return simplify(expand(n));
  } catch {
    return n;
  }
}

/** nth derivative, used by Taylor-series explanations. */
export function nthDerivative(n: Node, v: string, k: number): Node {
  let out = n;
  for (let i = 0; i < k; i++) out = differentiate(out, v);
  return out;
}

export { toNumber };
