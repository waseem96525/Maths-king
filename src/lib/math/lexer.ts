import type { FnName } from './ast';
import { FN_ARITY } from './ast';

export type TokKind = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'bang' | 'percent' | 'eq' | 'degree' | 'eof';

export interface Token {
  kind: TokKind;
  /** Raw source text of the token. */
  text: string;
  pos: number;
}

export class LexError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'LexError';
  }
}

const FN_ALIASES: Record<string, FnName> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  asin: 'asin',
  arcsin: 'asin',
  acos: 'acos',
  arccos: 'acos',
  atan: 'atan',
  arctan: 'atan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  sqrt: 'sqrt',
  sqr: 'sqrt',
  cbrt: 'cbrt',
  root: 'cbrt',
  abs: 'abs',
  ln: 'ln',
  log: 'log',
  lg: 'log',
  log2: 'log2',
  exp: 'exp',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  sign: 'sign',
  gcd: 'gcd',
  lcm: 'lcm',
  fact: 'fact',
  min: 'min',
  max: 'max',
  comb: 'comb',
  ncr: 'comb',
  nchoose: 'comb',
  choose: 'comb',
  perm: 'perm',
  npr: 'perm',
  mod: 'mod',
  rem: 'mod',
  modof: 'mod',
  rad: 'rad',
  radians: 'rad',
  hypot: 'hypot',
  logb: 'logb',
};

const CONST_ALIASES: Record<string, 'pi' | 'e'> = {
  pi: 'pi',
  '\u03c0': 'pi',
  tau: 'pi',
  e: 'e',
  euler: 'e',
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => /[A-Za-z\u0370-\u03FF\u03B1-\u03C9]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_\u0370-\u03FF\u03B1-\u03C9]/.test(c);

export function normalizeFunctionName(raw: string): FnName | null {
  return FN_ALIASES[raw.toLowerCase()] ?? null;
}

export function normalizeConstantName(raw: string): 'pi' | 'e' | null {
  return CONST_ALIASES[raw.toLowerCase()] ?? null;
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0') {
      i++;
      continue;
    }
    const start = i;
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      while (i < n && isDigit(src[i]!)) i++;
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        i++;
        while (i < n && isDigit(src[i]!)) i++;
      } else if (src[i] === '.' && !isIdentStart(src[i + 1] ?? '')) {
        // Trailing dot form such as "5."
        i++;
      }
      // Scientific notation
      if (src[i] === 'e' && (isDigit(src[i + 1] ?? '') || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2] ?? '')))) {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && isDigit(src[i]!)) i++;
      }
      toks.push({ kind: 'num', text: src.slice(start, i), pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      while (i < n && isIdentPart(src[i]!)) i++;
      toks.push({ kind: 'ident', text: src.slice(start, i), pos: start });
      continue;
    }
    switch (c) {
      case '(':
      case '[':
      case '{':
        toks.push({ kind: 'lparen', text: c, pos: start });
        i++;
        continue;
      case ')':
      case ']':
      case '}':
        toks.push({ kind: 'rparen', text: c, pos: start });
        i++;
        continue;
      case ',':
      case ';':
        toks.push({ kind: 'comma', text: c, pos: start });
        i++;
        continue;
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
        toks.push({ kind: 'op', text: c, pos: start });
        i++;
        continue;
      case '<':
      case '>': {
        if (src[i + 1] === '=') {
          toks.push({ kind: 'op', text: `${c}=`, pos: start });
          i += 2;
        } else {
          toks.push({ kind: 'op', text: c, pos: start });
          i++;
        }
        continue;
      }
      case '≠':
        toks.push({ kind: 'op', text: '!=', pos: start });
        i++;
        continue;
      case '=': {
        // Accept "==", "<=", ">=" and the arrow forms used in some notes.
        if (src[i + 1] === '=') i++;
        toks.push({ kind: 'eq', text: src.slice(start, i), pos: start });
        i++;
        continue;
      }
      case '!':
      case '\u00a1':
        toks.push({ kind: 'bang', text: '!', pos: start });
        i++;
        continue;
      case '%':
        toks.push({ kind: 'percent', text: '%', pos: start });
        i++;
        continue;
      case '\u00b0':
      case '\u2032':
        toks.push({ kind: 'degree', text: '\u00b0', pos: start });
        i++;
        continue;
      default:
        throw new LexError(`Unexpected character "${c}"`, start);
    }
  }
  toks.push({ kind: 'eof', text: '', pos: n });
  return toks;
}

export { FN_ARITY };
