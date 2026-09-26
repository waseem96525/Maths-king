/**
 * Turns a line of raw user input into a rendered, explained answer.
 *
 * This is the single entry point the UI and the API route share, so the two can
 * never drift. It is deliberately pure: no React, no `fetch`, no `process.env`.
 * Everything here is synchronous and runs identically on the server and in the
 * browser, which is what makes the offline engine the source of truth for every
 * answer rather than a fallback.
 */

import { type Node, isCmp, isEq } from './math/ast';
import { differentiate } from './math/differentiate';
import { collectVars, evaluate, MathError, tryEvaluateExact } from './math/evaluate';
import { definiteIntegrate, integrate } from './math/integrate';
import { toLatex, toPlain } from './math/latex';
import { normalizeMathInput } from './math/normalize';
import { ParseError, parseEquations, parseExpression } from './math/parser';
import { DivisionByZeroError, toString as ratToString, type Rational } from './math/rational';
import { tidy } from './math/simplify';
import {
  solveEquation,
  solveLinearInequality,
  solveLinearSystem,
  type AlgebraStep,
  type RootValue,
} from './math/solve';

export type SolveMode = 'auto' | 'evaluate' | 'simplify' | 'differentiate' | 'integrate' | 'solve';

export interface SolveRequest {
  input: string;
  mode?: SolveMode;
  /** Symbol to work with, e.g. `x`. Inferred from the input when omitted. */
  variable?: string;
}

export interface SolveStep {
  latex: string;
  why: string;
  title?: string;
}

export type SolveResult =
  | {
      ok: true;
      /** What the engine actually did, after resolving `auto`. */
      mode: Exclude<SolveMode, 'auto'>;
      /** The cleaned input, echoed back for display. */
      normalized: string;
      title: string;
      /** Headline answer, already rendered as LaTeX. */
      answerLatex: string;
      /** Plain-text form, for copying and screen readers. */
      answerPlain: string;
      steps: SolveStep[];
      /** True when no exact form existed and a numeric method was used. */
      approximate?: boolean;
    }
  | {
      ok: false;
      mode: Exclude<SolveMode, 'auto'>;
      normalized: string;
      error: string;
      /** A concrete next action, so an error is never a dead end. */
      hint?: string;
    };

const MAX_INPUT = 2000;

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/**
 * Unicode maths symbols a phone keyboard actually produces. A superscript or
 * subscript run is expanded to explicit `^`/`_` so `x²` and `x^2` are the same
 * input by the time the parser sees them.
 */
const UNICODE_REPLACEMENTS: Array<[RegExp, string | ((m: string) => string)]> = [
  [new RegExp(`[${SUPERSCRIPTS}]`, 'g'), (m) => `^${SUPERSCRIPTS.indexOf(m[0]!)}`],
  [new RegExp(`[${SUBSCRIPTS}]`, 'g'), (m) => `_${SUBSCRIPTS.indexOf(m[0]!)}`],
  [/[×✕✖·⋅]/g, '*'],
  [/[÷∕]/g, '/'],
  [/[−–—]/g, '-'],
  [/[∫]/g, 'int'],
  [/[√]/g, 'sqrt'],
  // `°` is deliberately left alone: the engine already parses it as a postfix
  // degree marker, and its normaliser rewrites the token `deg` into `°`, so
  // converting `30°` to `deg(30)` here would produce the unparseable `°(30)`.
  [/[π]/g, 'pi'],
  [/[θ]/g, 'theta'],
  [/[≠]/g, '!='],
  [/[≤]/g, '<='],
  [/[≥]/g, '>='],
];

/** Strip the LaTeX-only punctuation from a short rendered answer. */
function latexToPlain(latex: string): string {
  return latex
    .replace(/\\(?:left|right|!|,|;|:|quad|qquad|mathrm|text)\b/g, ' ')
    .replace(/\\geq/g, '>=')
    .replace(/\\leq/g, '<=')
    .replace(/\\neq/g, '!=')
    .replace(/\\infty/g, 'infinity')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanInput(raw: string): string {
  let s = raw ?? '';
  // Superscripts are expanded *before* NFKC. Normalising first would flatten
  // `x²` to `x2`, which the parser reads as the subscripted identifier `x_2`.
  for (const [pattern, replacement] of UNICODE_REPLACEMENTS) {
    s = replacement instanceof Function ? s.replace(pattern, replacement) : s.replace(pattern, replacement);
  }
  return s.normalize('NFKC').trim();
}

function numLatex(v: Rational): string {
  return toLatex({ t: 'num', v });
}

function numPlain(v: Rational): string {
  return ratToString(v);
}

function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty';
  return String(Number.isInteger(x) ? x : Number(x.toPrecision(12)));
}

function stepsOf(steps: AlgebraStep[]): SolveStep[] {
  return steps.map((s) => ({ latex: s.latex, why: s.why, title: s.title }));
}

function freeVariables(nodes: Node[]): string[] {
  const vars = new Set<string>();
  for (const n of nodes) for (const v of collectVars(n)) vars.add(v);
  return [...vars];
}

function describeError(err: unknown, body: string): { error: string; hint?: string } {
  if (err instanceof ParseError) {
    if (/system of equations/i.test(err.message)) {
      return {
        error: err.message,
        hint: 'Systems are supported: separate the equations with a comma, e.g. `2x + y = 5, x - y = 1`.',
      };
    }
    return {
      error: err.message,
      hint: `Check \`${body}\` — multiplication may be written \`2x\`, powers \`x^2\`, roots \`sqrt(x)\`.`,
    };
  }
  if (err instanceof MathError) {
    switch (err.code) {
      case 'division_by_zero':
        return { error: 'Division by zero is undefined.', hint: 'Check for a denominator that can reach 0.' };
      case 'domain':
        return { error: `${err.message} is outside the domain of that function.` };
      case 'unknown_symbol':
        return { error: err.message, hint: 'Every symbol must be a number, a known constant, or a variable.' };
      default:
        return { error: err.message };
    }
  }
  // A rational that cannot be built at all — dividing by zero, a zero raised to
  // a negative power — surfaces as a plain Error, and reporting it as a bare
  // "something went wrong" would hide the real cause.
  if (err instanceof DivisionByZeroError) {
    return { error: 'Division by zero is undefined.', hint: 'Check for a denominator that can reach 0.' };
  }
  return { error: err instanceof Error ? err.message : 'Something went wrong.' };
}

function fail(
  mode: Exclude<SolveMode, 'auto'>,
  normalized: string,
  error: string,
  hint?: string,
): SolveResult {
  return { ok: false, mode, normalized, error, hint };
}

function ok(
  mode: Exclude<SolveMode, 'auto'>,
  normalized: string,
  title: string,
  answerLatex: string,
  answerPlain: string,
  steps: SolveStep[] = [],
  approximate?: boolean,
): SolveResult {
  return { ok: true, mode, normalized, title, answerLatex, answerPlain, steps, approximate };
}

function rootPlain(root: RootValue, v: string): string {
  switch (root.kind) {
    case 'rational':
      return `${v} = ${numPlain(root.value)}`;
    case 'irrational':
      return `${v} ≈ ${root.value}`;
    case 'complex':
      return `${v} ≈ ${root.re} ${root.im < 0 ? '-' : '+'} ${Math.abs(root.im)}i`;
    case 'radical':
      // Matches the display in rootLatex: sqrt(d)/(2a) folded into the radical.
      return `${v} = a ± √d`;
    default:
      return v;
  }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

function runEvaluate(body: string, display: string): SolveResult {
  const mode = 'evaluate' as const;
  let node: Node;
  try {
    node = parseEquations(body)[0]!;
  } catch (err) {
    const { error, hint } = describeError(err, body);
    return fail(mode, display, error, hint);
  }
  const vars = freeVariables([node]);
  if (vars.length > 0) {
    // Nothing to evaluate: this is a formula, not a number.
    return ok(
      mode,
      display,
      'Expression',
      toLatex(node),
      toPlain(node),
      [
        {
          latex: toLatex(node),
          why: `This is a formula in ${vars.map((v) => `\`${v}\``).join(', ')}, so it has no single value. Use Differentiate, Integrate or Solve instead.`,
        },
      ],
    );
  }
  try {
    const exact = tryEvaluateExact(node, {});
    const answerLatex = exact ? numLatex(exact) : formatNumber(evaluate(node, {}));
    return ok(
      mode,
      display,
      'Result',
      answerLatex,
      exact ? numPlain(exact) : latexToPlain(answerLatex),
      [
        {
          latex: toLatex(node),
          why: exact
            ? 'Evaluated with exact rational arithmetic, so the answer carries no rounding error.'
            : 'No exact form exists for this value, so it is reported as a decimal.',
        },
      ],
      exact === null,
    );
  } catch (err) {
    const { error, hint } = describeError(err, body);
    return fail(mode, display, error, hint);
  }
}

function runSimplify(body: string, display: string): SolveResult {
  const mode = 'simplify' as const;
  let node: Node;
  try {
    node = parseExpression(body);
  } catch (err) {
    const { error, hint } = describeError(err, body);
    return fail(mode, display, error, hint);
  }
  const before = toLatex(node);
  const simplified = tidy(node);
  const after = toLatex(simplified);
  const steps: SolveStep[] = [{ latex: before, why: 'Expand the input, then collect like terms.' }];
  if (after !== before) steps.push({ latex: after, why: 'Nothing further can be combined.' });
  return ok(mode, display, 'Simplified', after, toPlain(simplified), steps);
}

function runDifferentiate(body: string, display: string, variable: string | undefined): SolveResult {
  const mode = 'differentiate' as const;
  let node: Node;
  try {
    node = parseExpression(body);
  } catch (err) {
    const { error, hint } = describeError(err, body);
    return fail(mode, display, error, hint);
  }
  const vars = freeVariables([node]);
  if (vars.length === 0) {
    return {
      ok: false,
      mode,
      normalized: display,
      error: 'There is no variable to differentiate with respect to.',
      hint: 'Use a variable, e.g. `x^2`, or name one explicitly, e.g. `t^2`.',
    };
  }
  const v = variable && vars.includes(variable) ? variable : vars[0]!;
  if (!vars.includes(v)) {
    return ok(mode, display, 'Derivative', '0', '0', [
      {
        latex: toLatex(node),
        why: `\`${v}\` does not appear in this expression, so its derivative with respect to \`${v}\` is 0.`,
      },
    ]);
  }
  const result = tidy(differentiate(node, v), v);
  const answerLatex = toLatex(result);
  return ok(
    mode,
    display,
    'Derivative',
    answerLatex,
    toPlain(result),
    [
      { latex: toLatex(node), why: `Differentiate with respect to \`${v}\`; every other symbol is a constant.` },
      { latex: answerLatex, why: 'Applied the product, quotient and chain rules, then simplified.' },
    ],
  );
}

function runIntegrate(body: string, display: string, variable: string | undefined): SolveResult {
  const mode = 'integrate' as const;
  // `int x^2 dx` — the trailing differential names the variable and is not part
  // of the integrand.
  const differential = /\s*d\s*([A-Za-z]\w*)\s*$/.exec(body);
  const integrandText = differential ? body.slice(0, differential.index).trim() : body;
  const named = differential ? differential[1]! : variable;

  let node: Node;
  try {
    node = parseExpression(integrandText);
  } catch (err) {
    const { error, hint } = describeError(err, integrandText);
    return fail(mode, display, error, hint);
  }
  const vars = freeVariables([node]);
  const v = named && vars.includes(named) ? named : (vars[0] ?? 'x');

  // `int x^2 from 0 to 1` — limits are read from the end of the input.
  const limits = /\s+from\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)\s*$/i.exec(integrandText);
  if (limits) {
    const lower = Number(limits[1]);
    const upper = Number(limits[2]);
    const bounded = parseExpression(integrandText.slice(0, limits.index));
    const result = definiteIntegrate(bounded, v, lower, upper);
    const answerLatex = result.exact ? numLatex(result.exact) : formatNumber(result.numeric);
    return ok(
      mode,
      display,
      'Definite integral',
      answerLatex,
      result.exact ? numPlain(result.exact) : latexToPlain(answerLatex),
      [
        {
          latex: `\\int_{${formatNumber(lower)}}^{${formatNumber(upper)}} ${toLatex(bounded)}\\, d${v}`,
          why: 'The limits came from the end of the input.',
        },
        {
          latex: answerLatex,
          why: result.usedNumericFallback
            ? 'No closed-form antiderivative was available, so adaptive Simpson integration was used.'
            : 'Evaluated exactly by substituting the limits into the antiderivative.',
        },
      ],
      result.usedNumericFallback,
    );
  }

  const result = integrate(node, v);
  if (!result) {
    return {
      ok: false,
      mode,
      normalized: display,
      error: `No antiderivative of this expression in \`${v}\` is available.`,
      hint: 'Covered: polynomials, products of powers, exponentials, logarithms and trigonometric functions. Try expanding a product first, or integrate a definite range with `from a to b`.',
    };
  }
  // The integrator emits a coefficient and its reciprocal separately, so
  // `3x^2` arrives as \frac{3x^{3}}{3}. Tidying cancels them to `x^3`, which is
  // what a person would write and what the check below then verifies.
  const tidyAntiderivative = tidy(result.antiderivative, v);
  const answerLatex = `${toLatex(tidyAntiderivative)} + C`;
  return ok(mode, display, 'Antiderivative', answerLatex, `${toPlain(tidyAntiderivative)} + C`, [
    {
      latex: `\\int ${toLatex(node)}\\, d${v}`,
      why: `Integrated with respect to \`${v}\`; every other symbol is treated as a constant.`,
    },
    {
      latex: answerLatex,
      why: `+ C is required because the derivative of a constant is 0, so no value of it can be recovered from the answer.${
        result.rules.length ? ` Rules used: ${result.rules.join(', ')}.` : ''
      }`,
    },
  ]);
}

function runSolve(body: string, display: string, variable: string | undefined): SolveResult {
  const mode = 'solve' as const;
  let nodes: Node[];
  try {
    nodes = parseEquations(body);
  } catch (err) {
    const { error, hint } = describeError(err, body);
    return fail(mode, display, error, hint);
  }
  const equations = nodes.filter((n): n is Extract<Node, { t: 'eq' }> => isEq(n));
  const comparisons = nodes.filter((n): n is Extract<Node, { t: 'cmp' }> => isCmp(n));

  if (equations.length === 0 && comparisons.length === 0) {
    return {
      ok: false,
      mode,
      normalized: display,
      error: 'Nothing to solve — no `=` or comparison was found.',
      hint: 'Try an equation (`2x + 5 = 15`), an inequality (`2x + 1 > 5`) or a system (`2x + y = 5, x - y = 1`).',
    };
  }

  if (equations.length === 0) {
    const result = solveLinearInequality(comparisons[0]!);
    if (!result) {
      return {
        ok: false,
        mode,
        normalized: display,
        error: 'This inequality is not linear in one variable, so it cannot be solved step by step.',
        hint: 'Linear inequalities are supported, e.g. `-2x + 3 <= 7`.',
      };
    }
    return ok(
      mode,
      display,
      'Solution',
      result.solutionLatex,
      latexToPlain(result.solutionLatex),
      stepsOf(result.steps),
    );
  }

  if (equations.length > 1) {
    const result = solveLinearSystem(equations);
    if (!result) {
      return {
        ok: false,
        mode,
        normalized: display,
        error: 'This is not a linear system in a consistent set of variables.',
        hint: 'Each equation must be linear, with one equation per variable: `x + y + z = 6, 2x - y + z = 5, x + 2y - z = 3`.',
      };
    }
    if (result.kind === 'none') {
      return ok(mode, display, 'No solution', '\\text{No solution}', 'No solution', stepsOf(result.steps));
    }
    if (result.kind === 'infinite') {
      return ok(
        mode,
        display,
        'Infinitely many solutions',
        '\\text{Infinitely many solutions}',
        'Infinitely many solutions',
        stepsOf(result.steps),
      );
    }
    const solution = result.solution ?? {};
    const pairs = result.variables.map((v) => ({ v, value: solution[v]! }));
    return ok(
      mode,
      display,
      'Solution',
      pairs.map((p) => `${p.v} = ${numLatex(p.value)}`).join(',\\quad '),
      pairs.map((p) => `${p.v} = ${numPlain(p.value)}`).join(', '),
      stepsOf(result.steps),
    );
  }

  const equation = equations[0]!;
  const result = solveEquation(equation, variable);
  if (!result) {
    return {
      ok: false,
      mode,
      normalized: display,
      error: 'This equation has no symbolic solution.',
      hint: 'Linear, quadratic and rational-root cubic equations are supported.',
    };
  }

  // Substitute every rational root back into the original equation. An answer
  // that does not satisfy what was asked is worse than no answer at all, so a
  // failure here is reported rather than rendered.
  for (const root of result.roots) {
    if (root.kind !== 'rational') continue;
    const value = Number(root.value.n) / Number(root.value.d);
    const lhs = tryEvaluateExact(equation.a, { [result.variable]: value });
    const rhs = tryEvaluateExact(equation.b, { [result.variable]: value });
    if (lhs && rhs && numPlain(lhs) !== numPlain(rhs)) {
      return {
        ok: false,
        mode,
        normalized: display,
        error: 'A root failed verification against the original equation, so the answer was discarded.',
        hint: 'This is an engine bug worth reporting — please include the exact input.',
      };
    }
  }

  return ok(
    mode,
    display,
    result.method,
    result.answerLatex,
    result.roots.map((r) => rootPlain(r, result.variable)).join(' or ') || 'No solution',
    stepsOf(result.steps),
  );
}

/* -------------------------------------------------------------------------- */
/* Intent detection                                                            */
/* -------------------------------------------------------------------------- */

interface Intent {
  mode: Exclude<SolveMode, 'auto'>;
  body: string;
  variable?: string;
}

/**
 * Read an intent prefix, if present.
 *
 * The prefix is stripped rather than merely detected, so `d/dx x^2` and `x^2`
 * reach the same expression — nobody should have to pick a mode just to say which
 * operation they meant.
 */
function readIntent(text: string): Intent | null {
  const derivative = /^\s*d\s*\/\s*d\s*([A-Za-z]\w*)\s+([\s\S]+)$/i.exec(text);
  if (derivative) {
    return { mode: 'differentiate', body: derivative[2]!.trim(), variable: derivative[1]! };
  }
  const prefixes: Array<[RegExp, Exclude<SolveMode, 'auto'>]> = [
    [
      /^\s*(?:differentiate|derivative|diff)(?:\s+of)?\s+(?:with respect to\s+([A-Za-z]\w*)\s+)?([\s\S]+)$/i,
      'differentiate',
    ],
    [/^\s*(?:integrate|integral|antiderivative|int)(?:\s+of)?\s+([\s\S]+)$/i, 'integrate'],
    [/^\s*(?:simplify|expand|collect)\s+([\s\S]+)$/i, 'simplify'],
    [/^\s*(?:evaluate|value\s+of|calculate|calc)\s+([\s\S]+)$/i, 'evaluate'],
    [/^\s*(?:solve|find|roots?\s+of)\s+([\s\S]+)$/i, 'solve'],
  ];
  for (const [pattern, mode] of prefixes) {
    const m = pattern.exec(text);
    if (!m) continue;
    if (mode === 'differentiate') {
      return { mode, body: m[2]!.trim(), variable: m[1] };
    }
    return { mode, body: m[1]!.trim() };
  }
  return null;
}

/* -------------------------------------------------------------------------- */

/** normalizeMathInput, falling back to the raw text when it cannot be read. */
function normalizeOr(text: string): string {
  try {
    return normalizeMathInput(text);
  } catch {
    return text;
  }
}

export function solve(request: SolveRequest): SolveResult {
  const cleaned = cleanInput(request.input);
  if (!cleaned) {
    return fail('evaluate', '', 'Type a maths problem to get started.', 'For example `2x + 5 = 15`.');
  }
  if (cleaned.length > MAX_INPUT) {
    return fail('evaluate', cleaned, `That input is ${cleaned.length} characters; the limit is ${MAX_INPUT}.`);
  }

  // An intent prefix is always consumed, whichever mode was asked for. Leaving
  // it in place used to turn `integrate` into a variable, so
  // `simplify (x+1)(x-1)` came back as
  // `\left(\text{simplify}2xx + 4\text{simplify}2x\right)...` whenever the
  // caller also passed an explicit mode, which is exactly what the mode buttons
  // and the example chips do.
  const intent = readIntent(cleaned);
  const body = normalizeOr(intent ? intent.body : cleaned);
  const requested = request.variable?.trim() || undefined;
  const variable = intent?.variable ?? requested;

  // An explicit mode wins, but it still benefits from the stripped prefix. With
  // no explicit mode, fall back to the prefix and then to the shape of the
  // expression.
  let mode: Exclude<SolveMode, 'auto'>;
  if (request.mode && request.mode !== 'auto') {
    mode = request.mode;
  } else if (intent) {
    mode = intent.mode;
  } else if (/=/.test(body) || /(<=|>=|!=|<|>)/.test(body)) {
    mode = 'solve';
  } else {
    // A bare formula has no value to evaluate, so the only operation that can
    // answer `x^3` is differentiating it. Evaluating would just say "no number".
    let isFormula = false;
    try {
      isFormula = freeVariables([parseExpression(body)]).length > 0;
    } catch {
      // Unparseable here means runEvaluate can explain the real problem.
    }
    mode = isFormula ? 'differentiate' : 'evaluate';
  }

  return run(mode, body, cleaned, variable);
}

function run(
  mode: Exclude<SolveMode, 'auto'>,
  body: string,
  display: string,
  variable: string | undefined,
): SolveResult {
  try {
    switch (mode) {
      case 'evaluate':
        return runEvaluate(body, display);
      case 'simplify':
        return runSimplify(body, display);
      case 'differentiate':
        return runDifferentiate(body, display, variable);
      case 'integrate':
        return runIntegrate(body, display, variable);
      case 'solve':
        return runSolve(body, display, variable);
    }
  } catch (err) {
    // Nothing below this point is allowed to reach the caller as a throw. An
    // unexpected engine fault must not become a 500 on the API or an unhandled
    // rejection in the browser; the user gets a reportable message instead.
    // A recognised fault (division by zero, a domain error) is reported as
    // itself, because that is the useful message.
    const known = err instanceof MathError || err instanceof DivisionByZeroError || err instanceof ParseError;
    if (known) {
      const { error, hint } = describeError(err, body);
      return fail(mode, display, error, hint);
    }
    return fail(
      mode,
      display,
      'The engine could not finish that problem.',
      `Something unexpected went wrong, so no answer is shown. Please report this with the input \`${display}\`. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

export const EXAMPLES: ReadonlyArray<{ label: string; input: string; mode: SolveMode }> = [
  { label: 'Linear', input: '2x + 5 = 15', mode: 'solve' },
  { label: 'Quadratic', input: 'x^2 - 5x + 6 = 0', mode: 'solve' },
  { label: 'System', input: '2x + y = 5, x - y = 1', mode: 'solve' },
  { label: 'Derivative', input: 'd/dx x^2 sin(x)', mode: 'differentiate' },
  { label: 'Integral', input: 'integrate 3x^2', mode: 'integrate' },
  { label: 'Simplify', input: 'simplify (x + 1)(x - 1)', mode: 'simplify' },
  { label: 'Exact', input: '1/3 + 1/6', mode: 'evaluate' },
  { label: 'Degrees', input: 'sin(30°)', mode: 'evaluate' },
];

export const CAPABILITIES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Solve',
    body: 'Linear and quadratic equations, rational-root cubics, linear systems and inequalities. Every root is substituted back in before it is shown.',
  },
  {
    title: 'Differentiate',
    body: 'Product, quotient, chain and power rules, simplified as far as exact rational arithmetic allows.',
  },
  {
    title: 'Integrate',
    body: 'Polynomials, powers, exponentials, logarithms and trigonometric functions, with adaptive Simpson integration for everything else.',
  },
  {
    title: 'Simplify',
    body: 'Expands products and small powers, then collects like terms into one canonical form.',
  },
];
