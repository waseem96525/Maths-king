import type { Rational } from './rational';

export type FnName =
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'sinh'
  | 'cosh'
  | 'tanh'
  | 'sqrt'
  | 'cbrt'
  | 'abs'
  | 'ln'
  | 'log'
  | 'log2'
  | 'exp'
  | 'floor'
  | 'ceil'
  | 'round'
  | 'sign'
  | 'gcd'
  | 'lcm'
  | 'fact'
  | 'min'
  | 'max'
  | 'comb'
  | 'perm'
  | 'mod'
  | 'rad'
  | 'deg'
  | 'hypot'
  | 'logb';

export const FN_ARITY: Record<FnName, [number, number]> = {
  sin: [1, 1],
  cos: [1, 1],
  tan: [1, 1],
  asin: [1, 1],
  acos: [1, 1],
  atan: [1, 1],
  sinh: [1, 1],
  cosh: [1, 1],
  tanh: [1, 1],
  sqrt: [1, 1],
  cbrt: [1, 1],
  abs: [1, 1],
  ln: [1, 1],
  log: [1, 2],
  log2: [1, 1],
  exp: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 1],
  sign: [1, 1],
  gcd: [2, 2],
  lcm: [2, 2],
  fact: [1, 1],
  min: [1, Infinity],
  max: [1, Infinity],
  comb: [2, 2],
  perm: [2, 2],
  mod: [2, 2],
  rad: [1, 1],
  deg: [1, 1],
  hypot: [2, Infinity],
  logb: [2, 2],
};

/** Integer-valued functions, used by the fact checker. */
export const INT_FN: ReadonlySet<FnName> = new Set<FnName>(['fact', 'floor', 'ceil', 'round', 'comb', 'perm', 'lcm', 'gcd', 'abs', 'sign']);

/** Functions that accept `n` distinct from the single-argument numeric path. */
export const MULTI_ARG_FN: ReadonlySet<FnName> = new Set<FnName>(['log', 'logb', 'mod', 'comb', 'perm', 'min', 'max', 'hypot', 'gcd', 'lcm']);

/** Functions that behave differently for exact (rational) inputs. */
export const EXACT_FN: ReadonlySet<FnName> = new Set<FnName>([
  'sqrt',
  'cbrt',
  'abs',
  'ln',
  'log',
  'log2',
  'floor',
  'ceil',
  'round',
  'sign',
  'gcd',
  'lcm',
  'fact',
  'min',
  'max',
  'comb',
  'perm',
  'mod',
  'rad',
  'deg',
  'hypot',
]);

export type Node =
  | { t: 'num'; v: Rational }
  | { t: 'var'; name: string }
  /** Named constant: pi or e. */
  | { t: 'const'; name: 'pi' | 'e' }
  | { t: '+'; a: Node; b: Node }
  | { t: '-'; a: Node; b: Node }
  | { t: '*'; a: Node; b: Node }
  | { t: '/'; a: Node; b: Node }
  | { t: '^'; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  | { t: 'fn'; name: FnName; args: Node[] }
  /** Only produced by the equation parser, never by the expression parser. */
  | { t: 'eq'; a: Node; b: Node }
  /** Inequality / relational comparison such as `2x + 1 > 5`. */
  | { t: 'cmp'; op: '<' | '>' | '<=' | '>=' | '!='; a: Node; b: Node };

export type CmpOp = '<' | '>' | '<=' | '>=' | '!=';

export const NUM = (v: Rational): Node => ({ t: 'num', v });
export const VAR = (name: string): Node => ({ t: 'var', name });
export const CONST = (name: 'pi' | 'e'): Node => ({ t: 'const', name });
export const ADD = (a: Node, b: Node): Node => ({ t: '+', a, b });
export const SUB = (a: Node, b: Node): Node => ({ t: '-', a, b });
export const MUL = (a: Node, b: Node): Node => ({ t: '*', a, b });
export const DIV = (a: Node, b: Node): Node => ({ t: '/', a, b });
export const POW = (a: Node, b: Node): Node => ({ t: '^', a, b });
export const NEG = (a: Node): Node => ({ t: 'neg', a });
export const FN = (name: FnName, args: Node[]): Node => ({ t: 'fn', name, args });
export const EQ = (a: Node, b: Node): Node => ({ t: 'eq', a, b });
export const CMP = (op: CmpOp, a: Node, b: Node): Node => ({ t: 'cmp', op, a, b });

export const isNum = (n: Node): n is Extract<Node, { t: 'num' }> => n.t === 'num';
export const isVar = (n: Node): n is Extract<Node, { t: 'var' }> => n.t === 'var';
export const isConst = (n: Node): n is Extract<Node, { t: 'const' }> => n.t === 'const';
export const isEq = (n: Node): n is Extract<Node, { t: 'eq' }> => n.t === 'eq';
export const isCmp = (n: Node): n is Extract<Node, { t: 'cmp' }> => n.t === 'cmp';

export function isNegative(n: Node): boolean {
  return (n.t === 'neg' && !isZeroNode(n.a)) || (n.t === 'num' && n.v.n < 0n);
}

export function isZeroNode(n: Node): boolean {
  return n.t === 'num' && n.v.n === 0n;
}

export function isOneNode(n: Node): boolean {
  return n.t === 'num' && n.v.n === n.v.d;
}
