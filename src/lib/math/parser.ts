import {
  ADD,
  CMP,
  CONST,
  DIV,
  FN,
  MUL,
  NEG,
  NUM,
  POW,
  SUB,
  VAR,
  type CmpOp,
  type FnName,
  type Node,
  FN_ARITY,
  MULTI_ARG_FN,
} from './ast';
import { fromDecimalString, rat, rneg } from './rational';
import { normalizeFunctionName, normalizeConstantName, tokenize, type Token } from './lexer';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface ParseResult {
  /** One entry per comma/`and`-separated equation, for systems of equations. */
  equations: Node[];
  /** The expression when the input is not an equation. */
  expression: Node | null;
}

class Parser {
  private toks: Token[];
  private i = 0;
  private argDepth = 0;

  constructor(src: string) {
    this.toks = tokenize(src);
  }

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)]!;
  }

  private next(): Token {
    const t = this.toks[this.i]!;
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }

  private atEnd(): boolean {
    return this.peek().kind === 'eof';
  }

  private expect(kind: Token['kind'], what: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${what} but found ${t.text ? `"${t.text}"` : 'the end of the input'}`, t.pos);
    }
    return this.next();
  }

  /** True when the upcoming token can begin a new operand (implicit product). */
  private startsOperand(): boolean {
    const k = this.peek().kind;
    return k === 'num' || k === 'ident' || k === 'lparen';
  }

  parseAll(): ParseResult {
    const equations: Node[] = [];
    let expression: Node | null = null;
    for (;;) {
      const left = this.parseExpr();
      if (this.peek().kind === 'eq') {
        this.next();
        const right = this.parseExpr();
        const eqNode: Node = { t: 'eq', a: left, b: right };
        equations.push(eqNode);
      } else if (this.isRelational()) {
        const op = this.next().text as CmpOp;
        const right = this.parseExpr();
        equations.push(CMP(op, left, right));
      } else {
        if (expression === null) expression = left;
        else throw new ParseError('Unexpected extra expression', this.peek().pos);
      }
      if (this.peek().kind === 'comma') {
        this.next();
        continue;
      }
      break;
    }
    if (!this.atEnd()) {
      throw new ParseError(`Unexpected "${this.peek().text}"`, this.peek().pos);
    }
    if (expression === null && equations.length === 0) {
      throw new ParseError('Nothing to evaluate', 0);
    }
    return { equations, expression };
  }

  private isRelational(): boolean {
    const t = this.peek();
    return t.kind === 'op' && (t.text === '<' || t.text === '>' || t.text === '<=' || t.text === '>=' || t.text === '!=');
  }

  parseExpr(): Node {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && t.text === '+') {
        this.next();
        left = ADD(left, this.parseTerm());
      } else if (t.kind === 'op' && t.text === '-') {
        this.next();
        left = SUB(left, this.parseTerm());
      } else {
        return left;
      }
    }
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && t.text === '*') {
        this.next();
        left = MUL(left, this.parseUnary());
      } else if (t.kind === 'op' && t.text === '/') {
        this.next();
        left = DIV(left, this.parseUnary());
      } else if (this.startsOperand()) {
        left = MUL(left, this.parseUnary());
      } else {
        return left;
      }
    }
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.kind === 'op' && t.text === '-') {
      this.next();
      const operand = this.parseUnary();
      // A signed literal is one number, not a negation of one. `x^-1` has to
      // parse as POW(x, NUM(-1)) rather than POW(x, NEG(NUM(1))), because the
      // power rule, the polynomial collector and the integrator all recognise a
      // constant exponent by testing `isNum(n.b)` — a `neg` wrapper defeats
      // every one of them and pushes `x^-1` down the general variable-exponent
      // path, which returns an uncollected product.
      //
      // The power still binds to the operand, not to the sign, so `-3^2` is
      // -(3^2) = -9: the inner call has already consumed `^2` by the time the
      // sign is applied, so only a bare literal is ever folded here.
      if (operand.t === 'num') return NUM(rneg(operand.v));
      return NEG(operand);
    }
    if (t.kind === 'op' && t.text === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.kind === 'op' && t.text === '^') {
      this.next();
      // Right-associative, and the exponent may itself be signed: 2^-3
      const exp = this.parseUnary();
      return POW(base, exp);
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'bang') {
        this.next();
        node = FN('fact', [node]);
      } else if (t.kind === 'percent') {
        this.next();
        node = MUL(node, DIV(NUM(rat(1n)), NUM(rat(100n))));
      } else if (t.kind === 'degree') {
        this.next();
        node = this.applyDegrees(node);
      } else {
        return node;
      }
    }
  }

  /**
   * `°` converts to radians. When it trails a function call the conversion is
   * pushed into the arguments so that `sin 30°` becomes `sin(30 * pi/180)`.
   */
  private applyDegrees(node: Node): Node {
    if (node.t === 'fn') {
      return { t: 'fn', name: node.name, args: node.args.map((a) => this.toRadians(a)) };
    }
    return this.toRadians(node);
  }

  /**
   * `x°` is `x*pi/180`, built as a single fraction over 180 rather than as a
   * product with `pi/180`. The product shape nests a division inside a
   * multiplication, which renders as \frac{n1\pi}{180} and hides the fact that
   * the value is a plain multiple of pi.
   */
  private toRadians(node: Node): Node {
    if (node.t === 'num' || node.t === 'const') return DIV(MUL(node, CONST('pi')), NUM(rat(180n)));
    return node;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.kind === 'num') {
      this.next();
      return NUM(fromDecimalString(t.text));
    }
    if (t.kind === 'lparen') {
      this.next();
      const inner = this.parseExpr();
      // A comma directly inside parentheses is not a value — `min(1, 2)` is how
      // you pass several arguments, so `(1, 2)` is a typo worth reporting.
      this.expect('rparen', '")"');
      return inner;
    }
    if (t.kind === 'ident') {
      this.next();
      const raw = t.text;
      const konst = normalizeConstantName(raw);
      const fn = normalizeFunctionName(raw);
      // A name that is neither a known function nor a known constant is a
      // variable — this is what makes "f(x) = 2x" work.
      if (konst !== null) return CONST(konst);
      if (fn === null) return VAR(raw);
      return this.parseCall(fn, raw, t.pos);
    }
    throw new ParseError(`Unexpected ${t.text ? `"${t.text}"` : 'end of input'}`, t.pos);
  }

  private parseCall(fn: FnName, raw: string, pos: number): Node {
    const [minA, maxA] = FN_ARITY[fn];
    if (this.peek().kind === 'lparen') {
      this.next();
      const args: Node[] = [];
      this.argDepth++;
      if (this.peek().kind !== 'rparen') {
        for (;;) {
          args.push(this.parseExpr());
          if (this.peek().kind !== 'comma') break;
          this.next();
        }
      }
      this.argDepth--;
      this.expect('rparen', '")" to close the arguments');
      if (args.length < minA || args.length > maxA) {
        throw new ParseError(
          `${raw} expects ${minA === maxA ? minA : `${minA} to ${maxA}`} argument(s) but got ${args.length}`,
          pos,
        );
      }
      return FN(fn, args);
    }
    if (this.startsOperand()) {
      // Implicit single argument, e.g. "sqrt 2" or "sin x".
      return FN(fn, [this.parseTerm()]);
    }
    // A bare function name used as a symbol, e.g. "log" in "log = 5".
    if (MULTI_ARG_FN.has(fn)) return VAR(raw);
    throw new ParseError(`${raw} needs an argument, for example ${raw}(x)`, pos);
  }
}

export function parseExpression(src: string): Node {
  const p = new Parser(src);
  const r = p.parseAll();
  if (r.equations.length === 1) return r.equations[0]!;
  if (r.equations.length > 1) {
    throw new ParseError('This looks like a system of equations — pass the whole system instead', 0);
  }
  if (!r.expression) throw new ParseError('Nothing to evaluate', 0);
  return r.expression;
}

export function parseEquations(src: string): Node[] {
  const p = new Parser(src);
  const r = p.parseAll();
  const out: Node[] = [...r.equations];
  if (r.expression) out.push(r.expression);
  return out;
}

export function tryParseExpression(src: string): Node | null {
  try {
    return parseExpression(src);
  } catch {
    return null;
  }
}

export function tryParseEquations(src: string): Node[] | null {
  try {
    return parseEquations(src);
  } catch {
    return null;
  }
}
