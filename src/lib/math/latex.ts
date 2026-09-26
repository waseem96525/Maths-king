import { DIV, type FnName, MUL, NUM, type Node, isNum, INT_FN } from './ast';
import {
  isNeg,
  rneg,
  toDecimalString,
  toString as ratToString,
  rmul,
  type Rational,
} from './rational';

/**
 * AST -> LaTeX renderer.
 *
 * Precedence-aware so that `MUL(ADD(x,1), ADD(x,1))` renders as
 * `(x + 1)(x + 1)` rather than `x + 1x + 1`.
 */

const PREC_SUM = 1;
const PREC_PROD = 2;
const PREC_UNARY = 3;
const PREC_POW = 4;
const PREC_ATOM = 5;

const GREEK: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  Delta: '\\Delta',
  epsilon: '\\varepsilon',
  theta: '\\theta',
  Theta: '\\Theta',
  lambda: '\\lambda',
  Lambda: '\\Lambda',
  mu: '\\mu',
  nu: '\\nu',
  pi: '\\pi',
  Pi: '\\Pi',
  rho: '\\rho',
  sigma: '\\sigma',
  Sigma: '\\Sigma',
  tau: '\\tau',
  phi: '\\phi',
  Phi: '\\Phi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
  Omega: '\\Omega',
};

const FN_LATEX: Record<string, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  asin: '\\sin^{-1}',
  acos: '\\cos^{-1}',
  atan: '\\tan^{-1}',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  ln: '\\ln',
  log: '\\log',
  log2: '\\log_{2}',
  exp: '\\exp',
  abs: '\\left|',
  floor: '\\left\\lfloor',
  ceil: '\\left\\rceil',
  sign: '\\operatorname{sgn}',
  min: '\\min',
  max: '\\max',
  comb: 'C',
  perm: 'P',
  hypot: '\\sqrt',
  gcd: '\\gcd',
  lcm: '\\operatorname{lcm}',
  mod: '\\bmod',
  deg: '{}^{\\circ}',
  rad: '\\operatorname{rad}',
  logb: '\\log',
};

const RESERVED_WORDS = new Set([
  'min',
  'max',
  'log',
  'ln',
  'sin',
  'cos',
  'tan',
  'gcd',
  'lcm',
  'mod',
  'comb',
  'perm',
  'deg',
  'rad',
  'abs',
  'sign',
  'fact',
  'exp',
  'sqrt',
  'cbrt',
  'root',
  'pi',
  'e',
  'inf',
  'hypot',
  'logb',
  'asin',
  'acos',
  'atan',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'log2',
  'floor',
  'ceil',
  'round',
]);

export function isReservedName(name: string): boolean {
  return RESERVED_WORDS.has(name);
}

function prec(n: Node): number {
  switch (n.t) {
    case '+':
    case '-':
      return PREC_SUM;
    case '*':
    case '/':
      return PREC_PROD;
    case 'neg':
      return PREC_UNARY;
    case '^':
      return PREC_POW;
    case 'fn':
      if (n.name === 'fact') return PREC_POW;
      return PREC_ATOM;
    default:
      return PREC_ATOM;
  }
}

export interface LatexOptions {
  /** Prefer exact fractions over terminating decimals. Defaults to true. */
  exactFractions?: boolean;
  /** Render `deg(x)` as a superscript degree instead of a function call. */
  inline?: boolean;
}

function renderNumber(v: Rational, opts: LatexOptions): string {
  if (v.d === 1n) return v.n.toString();
  // Same reasoning as `fractionWithSign`: this always renders a standalone
  // literal, so the minus can never belong to anything but this number.
  if (isNeg(v)) return `-${renderNumber(rneg(v), opts)}`;
  const exact = opts.exactFractions !== false;
  // `rat` normalises the denominator positive; abs keeps a hand-built Rational
  // from measuring the sign character as if it were a digit.
  const bits = (v.d < 0n ? -v.d : v.d).toString(2).length;
  if (exact && bits <= 40) return `\\frac{${v.n}}{${v.d}}`;
  return toDecimalString(v, 12);
}

function renderVarName(name: string): string {
  if (GREEK[name]) return GREEK[name];
  if (name.length === 1) return name;
  // Subscripted names such as x1 or a12 read better as x_{1}.
  const m = /^([A-Za-z\\]+?)(\d+)$/.exec(name);
  if (m) return `${renderVarName(m[1]!)}_{${m[2]!}}`;
  return `\\text{${name.replace(/([#&%_{}])/g, '\\$1')}}`;
}

/**
 * Functions whose argument already carries its own brackets. Adding
 * `\left(...\right)` around one of those produces `ln(|x|)`, which is a nesting
 * artefact rather than anything a person writes.
 */
const SELF_DELIMITED: ReadonlySet<FnName> = new Set<FnName>(['abs', 'floor', 'ceil']);

function renderFnArgs(args: Node[], opts: LatexOptions): string {
  if (args.length === 1 && args[0]!.t === 'fn' && SELF_DELIMITED.has(args[0]!.name)) {
    return node(args[0]!, opts, 0);
  }
  return `\\left(${args.map((a) => node(a, opts, 0)).join(', ')}\\right)`;
}

function renderFnCall(n: Extract<Node, { t: 'fn' }>, opts: LatexOptions): string {
  const { name, args } = n;
  switch (name) {
    case 'sqrt':
      return `\\sqrt{${node(args[0]!, opts, 0)}}`;
    case 'cbrt':
      return `\\sqrt[3]{${node(args[0]!, opts, 0)}}`;
    // e^x reads better than \exp(x) in a worked solution.
    case 'exp':
      return `e^{${node(args[0]!, opts, 0)}}`;
    case 'fact':
      return `${node(args[0]!, opts, PREC_POW + 1)}!`;
    case 'abs':
      return `\\left|${node(args[0]!, opts, 0)}\\right|`;
    case 'floor':
      return `\\left\\lfloor ${node(args[0]!, opts, 0)} \\right\\rfloor`;
    case 'ceil':
      return `\\left\\rceil ${node(args[0]!, opts, 0)} \\right\\rceil`;
    case 'log': {
      if (args.length === 2) {
        return `\\log_{${node(args[0]!, opts, 0)}}\\left(${node(args[1]!, opts, 0)}\\right)`;
      }
      return `\\log\\left(${node(args[0]!, opts, 0)}\\right)`;
    }
    case 'logb':
      return `\\log_{${node(args[0]!, opts, 0)}}\\left(${node(args[1]!, opts, 0)}\\right)`;
    case 'min':
    case 'max':
    case 'hypot':
      return `${FN_LATEX[name]}\\left(${args.map((a) => node(a, opts, 0)).join(', ')}\\right)`;
    case 'comb':
    case 'perm':
      return `${FN_LATEX[name]}\\left(${args.map((a) => node(a, opts, 0)).join(', ')}\\right)`;
    case 'mod':
      return `${node(args[0]!, opts, PREC_SUM)}\\bmod ${node(args[1]!, opts, PREC_SUM)}`;
    case 'deg':
      return `${node(args[0]!, opts, PREC_POW + 1)}^{\\circ}`;
    case 'rad':
      return `\\operatorname{rad}\\left(${node(args[0]!, opts, 0)}\\right)`;
    case 'gcd':
    case 'lcm':
      return `${FN_LATEX[name]}\\left(${args.map((a) => node(a, opts, 0)).join(', ')}\\right)`;
    case 'sign':
      return `\\operatorname{sgn}\\left(${args.map((a) => node(a, opts, 0)).join(', ')}\\right)`;
    default: {
      const base = FN_LATEX[name] ?? `\\operatorname{${name}}`;
      if (args.length === 0) return base;
      return `${base}${renderFnArgs(args, opts)}`;
    }
  }
}

/**
 * Render an addition or subtraction.
 *
 * Parentheses follow ordinary precedence: `a + b*c` needs none, but the left
 * side of a subtraction does, because `(a + b) - c` is not `a + b - c`. A sum
 * on the *right* of either operator never needs them, since `a - (b + c)` and
 * `a - b - c` agree.
 */
function renderChildren(op: '+' | '-', a: Node, b: Node, opts: LatexOptions): string {
  const left = node(a, opts, op === '-' ? PREC_SUM + 1 : PREC_SUM);
  const right = node(b, opts, PREC_SUM);
  return `${left} ${op} ${right}`;
}

export function node(n: Node, opts: LatexOptions = {}, minPrec = 0): string {
  const p = prec(n);
  const body = renderNode(n, opts);
  if (p < minPrec) return `\\left(${body}\\right)`;
  return body;
}

function renderNode(n: Node, opts: LatexOptions): string {
  switch (n.t) {
    case 'num':
      return renderNumber(n.v, opts);
    case 'var':
      return renderVarName(n.name);
    case 'const':
      return n.name === 'pi' ? '\\pi' : 'e';
    case '+':
      return renderChildren('+', n.a, n.b, opts);
    case '-':
      return renderChildren('-', n.a, n.b, opts);
    case 'neg':
      return `-${node(n.a, opts, PREC_UNARY)}`;
    case '*':
      return renderProduct(n.a, n.b, opts);
    case '/': {
      // Unwrap a top-level negation into a leading minus: \frac{-x}{2} reads
      // better as -\frac{x}{2}. Only an outright `neg` (or a negative literal)
      // qualifies, never a numerator that merely starts with a minus.
      if (n.a.t === 'neg') return `-${node(DIV(n.a.a, n.b), opts, 0)}`;
      if (isNum(n.a) && isNeg(n.a.v)) return `-${node(DIV(NUM(rneg(n.a.v)), n.b), opts, 0)}`;
      return `\\frac{${node(n.a, opts, 0)}}{${node(n.b, opts, 0)}}`;
    }
    case '^': {
      const base = node(n.a, opts, PREC_POW + 1);
      const exp = node(n.b, opts, 0);
      return `${base}^{${exp}}`;
    }
    case 'fn':
      return renderFnCall(n, opts);
    case 'eq':
      return `${node(n.a, opts, PREC_SUM)} = ${node(n.b, opts, PREC_SUM)}`;
    case 'cmp':
      return `${node(n.a, opts, PREC_SUM)} ${n.op === '!=' ? '\\neq' : n.op} ${node(n.b, opts, PREC_SUM)}`;
    default: {
      const never: never = n;
      return String(never);
    }
  }
}

/**
 * `-\frac{1}{x^2}` is easier to read than `\frac{-1}{x^2}`, so a negative
 * numerator is lifted outside the fraction.
 *
 * Only ever applied where the whole numerator is a single signed term. Lifting
 * the minus off `(-x - 1)/2` would silently change its value, which is why this
 * is driven by the sign of a coefficient rather than by sniffing the rendered
 * numerator for a leading `-`.
 */
function fractionWithSign(v: Rational, build: (magnitude: Rational) => string): string {
  return isNeg(v) ? `-${build(rneg(v))}` : build(v);
}

/**
 * Multiplication is rendered as juxtaposition when it reads naturally
 * (`2x`, `(x+1)(x-1)`) and with an explicit operator when it does not
 * (`2 \\cdot 3` stays `2 \\times 3` for readability of plain numbers).
 */
/**
 * Multiply a numeric coefficient into one factor of a product, returning the
 * rebuilt product. Returns null when there is no numeric factor to absorb it,
 * which is the signal that plain juxtaposition would be wrong.
 */
function foldCoefficientIntoProduct(coeff: Rational, product: Node): Node | null {
  if (product.t !== '*') return null;
  if (isNum(product.a)) return MUL(NUM(rmul(coeff, product.a.v)), product.b);
  if (isNum(product.b)) return MUL(product.a, NUM(rmul(coeff, product.b.v)));
  return null;
}

function renderProduct(a: Node, b: Node, opts: LatexOptions): string {
  // `node(..., PREC_PROD)` already parenthesises anything that binds more
  // loosely than a product, so `(x+1)(x-1)` comes out right without adding a
  // second layer of brackets here.
  const left = node(a, opts, PREC_PROD);
  const right = node(b, opts, PREC_PROD);
  const leftNum = isNum(a) && a.v.d === 1n;
  const rightNum = isNum(b) && b.v.d === 1n;
  if (leftNum && rightNum) return `${left} \\times ${right}`;
  if (leftNum && a.v.d !== 1n) return `${left} \\times ${right}`;
  if (rightNum && b.v.d !== 1n) return `${left} \\div ${right}`;
  // A rational coefficient in front of a single factor reads better as one
  // fraction: (3/2)x^2 becomes \frac{3x^2}{2}, not \frac{3}{2}x^2.
  if (isNum(a) && a.v.d !== 1n && (b.t === 'var' || b.t === '^' || b.t === 'fn' || b.t === 'const')) {
    // PREC_POW, not PREC_ATOM: a power is already atomic for juxtaposition, so
    // demanding an atom here would bracket x^2 into \frac{3\left(x^2\right)}{2}.
    // A numerator of 1 is noise: \frac{1x^{2}}{4} reads as a coefficient of
    // one written out, where \frac{x^{2}}{4} is what a person would write.
    return fractionWithSign(a.v, (m) =>
      m.n === 1n ? `\\frac{${node(b, opts, PREC_POW)}}{${m.d}}` : `\\frac{${m.n}${node(b, opts, PREC_POW)}}{${m.d}}`,
    );
  }
  // Fold a whole-number coefficient into an existing fraction: 3 * x^2/2
  // becomes \frac{3x^2}{2}.
  if (leftNum && b.t === '/') {
    // Captured before the closures below: aliasing a type guard holds inside a
    // callback, but re-reading `a.v` / `b.a` within one does not narrow.
    const coeff = a.v;
    const numNode = b.a;
    const den = node(b.b, opts, PREC_PROD);
    if (isNum(numNode)) {
      const numer = numNode.v;
      return fractionWithSign(rmul(coeff, numer), (m) => `\\frac{${renderNumber(m, opts)}}{${den}}`);
    }
    // A numerator that is itself a product has to absorb the coefficient as a
    // factor rather than have it pasted on the front. Juxtaposition below is
    // only valid when the numerator is a single atom, so `30 * (1*pi)/180`
    // would otherwise render as the nonsense \frac{301\pi}{180}.
    const folded = foldCoefficientIntoProduct(coeff, numNode);
    if (folded) {
      return fractionWithSign(coeff, (m) => `\\frac{${node(folded, opts, PREC_PROD)}}{${den}}`);
    }
    return fractionWithSign(coeff, (m) => `\\frac{${renderNumber(m, opts)}${node(numNode, opts, PREC_PROD)}}{${den}}`);
  }
  return `${left}${right}`;
}

export function toLatex(n: Node, opts: LatexOptions = {}): string {
  return node(n, opts, 0);
}

/** Plain-text form, used for screen-reader labels and search indexing. */
export function toPlain(n: Node): string {
  switch (n.t) {
    case 'num':
      return toDecimalString(n.v, 8);
    case 'var':
      return n.name;
    case 'const':
      return n.name === 'pi' ? 'pi' : 'e';
    case '+':
      return `${toPlain(n.a)} + ${toPlain(n.b)}`;
    case '-':
      return `${toPlain(n.a)} - ${toPlain(n.b)}`;
    case 'neg':
      return `-${toPlain(n.a)}`;
    case '*':
      // An explicit operator: `xx` is ambiguous to read aloud, and this string
      // is what feeds screen readers and search indexing.
      return `${toPlain(n.a)}*${toPlain(n.b)}`;
    case '/':
      return `${toPlain(n.a)}/${toPlain(n.b)}`;
    case '^':
      return `${toPlain(n.a)}^${toPlain(n.b)}`;
    case 'fn': {
      if (n.name === 'sqrt') return `sqrt(${toPlain(n.args[0]!)})`;
      return `${n.name}(${n.args.map(toPlain).join(', ')})`;
    }
    case 'eq':
      return `${toPlain(n.a)} = ${toPlain(n.b)}`;
    case 'cmp':
      return `${toPlain(n.a)} ${n.op} ${toPlain(n.b)}`;
    default:
      return '';
  }
}

export { INT_FN, ratToString };
