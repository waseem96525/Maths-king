/**
 * Normalises the many ways a human (or an OCR engine, or a copy-paste from a
 * textbook) can write mathematics into a single plain-text syntax that the
 * lexer understands.
 *
 * Examples handled:
 *   \frac{-b \pm \sqrt{b^2-4ac}}{2a}  ->  ((-b + root((b^2)-(4a c)))/(2a))
 *   x^{2} - 5x + 6 = 0                  ->  x^(2) - 5 x + 6 = 0
 *   \left| -3 \right|                  ->  abs(-3)
 *   1,000                              ->  1000
 */

type Replacer = string | ((substring: string, ...args: never[]) => string);

const REPLACEMENTS: Array<[RegExp, Replacer]> = [
  [/\\left\s*/g, ''],
  [/\\right\s*/g, ''],
  [/\\!|\\,|\\;|\\:|\\quad|\\qquad|\\ |~/g, ' '],
  [/\\cdot|\\cdotp|\\times|\\ast/g, '*'],
  [/\\div/g, '/'],
  [/\\pm/g, '±'],
  [/\\mp/g, '∓'],
  [/\\neq|\\ne/g, '≠'],
  [/\\leq|\\le(?![a-zA-Z])/g, '<='],
  [/\\geq|\\ge(?![a-zA-Z])/g, '>='],
  [/\\lt(?![a-zA-Z])/g, '<'],
  [/\\gt(?![a-zA-Z])/g, '>'],
  [/\\approx/g, '≈'],
  [/\\equiv/g, '='],
  [/\\to|\\rightarrow|\\Rightarrow|\\implies/g, '=>'],
  [/\\ldots|\\dots|\\cdots/g, ','],
  [/\\infty/g, 'Inf'],
  [/\\pi/g, 'pi'],
  [/\\theta/g, 'theta'],
  [/\\alpha/g, 'alpha'],
  [/\\beta/g, 'beta'],
  [/\\gamma/g, 'gamma'],
  [/\\lambda/g, 'lambda'],
  [/\\mu/g, 'mu'],
  [/\\sigma|\\Sigma/g, 'sigma'],
  [/\\phi/g, 'phi'],
  [/\\omega/g, 'omega'],
  // Multi-letter LaTeX operators must be matched before the single-letter
  // rule below, otherwise "\sinh" would be split into "s" + "inh".
  [/\\arcsin|\\arccos|\\arctan|\\sinh|\\cosh|\\tanh/g, (m) => m.slice(1).toLowerCase()],
  [/\\(sin|cos|tan|cot|sec|csc|log|ln|exp)(?![a-zA-Z])/g, (m) => m.slice(1).toLowerCase()],
  [/\\/g, ''],
  [/[‘’“”]/g, ''],
  [/−/g, '-'],
  [/×/g, '*'],
  [/÷/g, '/'],
  [/ | | /g, ' '],
  [/\u00d7/g, '*'],
  [/\s+/g, ' '],
];

function readGroup(s: string, start: number): { body: string; end: number } | null {
  // start points at the '{' (or any single char when not braced)
  if (s[start] === '{' || s[start] === '(' || s[start] === '[') {
    const open = s[start]!;
    const close = open === '{' ? '}' : open === '(' ? ')' : ']';
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const c = s[i]!;
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return { body: s.slice(start + 1, i), end: i + 1 };
      }
    }
    return null;
  }
  return { body: s[start] ?? '', end: start + 1 };
}

/** Replace `\cmd{...}{...}` style constructs with plain equivalents. */
function expandGroupedCommands(input: string): string {
  let s = input;
  let guard = 0;
  for (;;) {
    if (guard++ > 4000) break;
    const idx = s.indexOf('\\frac');
    const idxT = s.indexOf('\\dfrac');
    const idxS = s.indexOf('\\tfrac');
    const idxC = s.indexOf('\\binom');
    const cands = [
      { i: idxS >= 0 ? idxS : idxT, len: 6 },
      { i: idx, len: 5 },
      { i: idxC, len: 6 },
    ].filter((c) => c.i >= 0);
    if (cands.length === 0) break;
    cands.sort((a, b) => a.i - b.i);
    const { i, len } = cands[0]!;
    let p = i + len;
    while (s[p] === ' ') p++;
    const a = readGroup(s, p);
    if (!a) {
      s = `${s.slice(0, i)} ${s.slice(i + len)}`;
      continue;
    }
    p = a.end;
    while (s[p] === ' ') p++;
    let replacement: string;
    if (s.startsWith('\\binom', i)) {
      const b = readGroup(s, p);
      if (!b) {
        s = s.slice(0, i) + s.slice(i + len);
        continue;
      }
      replacement = `comb(${a.body}, ${b.body})`;
      s = `${s.slice(0, i)}${replacement}${s.slice(b.end)}`;
    } else {
      const b = readGroup(s, p);
      if (!b) {
        s = s.slice(0, i) + s.slice(i + len);
        continue;
      }
      replacement = `((${a.body})/(${b.body}))`;
      s = `${s.slice(0, i)}${replacement}${s.slice(b.end)}`;
    }
  }
  return s;
}

function expandSqrt(input: string): string {
  let s = input;
  let guard = 0;
  for (;;) {
    if (guard++ > 2000) break;
    const i = s.indexOf('\\sqrt');
    if (i < 0) break;
    let p = i + 5;
    while (s[p] === ' ') p++;
    let indexArg: string | null = null;
    if (s[p] === '[') {
      const g = readGroup(s, p);
      if (g) {
        indexArg = g.body;
        p = g.end;
        while (s[p] === ' ') p++;
      }
    }
    const g = readGroup(s, p);
    if (!g) {
      s = `${s.slice(0, i)} ${s.slice(i + 5)}`;
      continue;
    }
    const inner = `(${g.body})`;
    const repl = indexArg ? `((${inner})^(1/(${indexArg})))` : `sqrt${inner}`;
    s = `${s.slice(0, i)}${repl}${s.slice(g.end)}`;
  }
  return s;
}

function expandAbs(input: string): string {
  let s = input;
  let guard = 0;
  for (;;) {
    if (guard++ > 500) break;
    const m = /\\lvert|\\rvert|\\vert|\\lVert|\\rVert/.exec(s);
    if (!m || m.index === undefined) break;
    const open = s[m.index] === '\\' ? m[0] : m[0];
    const isVert = open.includes('vert') && !open.includes('Vert');
    const closer = isVert ? /\\r?(?:vert|lvert|rvert)/ : /\\r?Vert/;
    const rest = s.slice(m.index + m[0].length);
    const cm = closer.exec(rest);
    if (!cm || cm.index === undefined) {
      s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
      continue;
    }
    const body = rest.slice(0, cm.index);
    s = `${s.slice(0, m.index)}abs(${body})${rest.slice(cm.index + cm[0].length)}`;
  }
  return s;
}

function expandScripts(input: string): string {
  let s = input;
  let guard = 0;
  // `x^{2}` -> `x^(2)`. A bare `x^2` is already valid for the parser, so it is
  // left untouched — that also guarantees the loop makes progress.
  for (;;) {
    if (guard++ > 2000) break;
    const m = /([A-Za-z0-9)\]])\^\s*\{/.exec(s);
    if (!m || m.index === undefined) break;
    const at = m.index + m[0].length - 1;
    const g = readGroup(s, at);
    if (!g) {
      s = `${s.slice(0, at)}{${s.slice(at + 1)}`;
      continue;
    }
    s = `${s.slice(0, m.index)}${m[1]}^(${g.body})${s.slice(g.end)}`;
  }
  // `x_{1}` -> `x1`, which the lexer reads as a single identifier.
  for (;;) {
    if (guard++ > 4000) break;
    const m = /([A-Za-z])_\s*\{/.exec(s);
    if (!m || m.index === undefined) break;
    const at = m.index + m[0].length - 1;
    const g = readGroup(s, at);
    if (!g) {
      s = `${s.slice(0, at)}{${s.slice(at + 1)}`;
      continue;
    }
    s = `${s.slice(0, m.index)}${m[1]}${g.body.replace(/[^A-Za-z0-9]/g, '')}${s.slice(g.end)}`;
  }
  return s;
}

function expandDelimiters(input: string): string {
  let s = input;
  let guard = 0;
  // \begin{...} ... \end{...} used for matrices and aligned systems.
  for (;;) {
    if (guard++ > 100) break;
    const m = /\\begin\{([a-zA-Z*]+)\}/.exec(s);
    if (!m || m.index === undefined) break;
    const envName = m[1]!.replace('*', '');
    const endTag = `\\end{${envName}}`;
    const endIdx = s.indexOf(endTag, m.index);
    const body = endIdx >= 0 ? s.slice(m.index + m[0].length, endIdx) : s.slice(m.index + m[0].length);
    // Rows separated by \\ and cells by &
    const rows = body
      .split(/\\\\/)
      .map((r) => r.replace(/&/g, ',').trim())
      .filter((r) => r.length > 0);
    if (rows.length === 0) {
      s = s.slice(0, m.index) + (endIdx >= 0 ? s.slice(endIdx + endTag.length) : '');
      continue;
    }
    // A system: keep only the first column of each row when every row has >1 cell.
    const cells = rows.map((r) => r.split(',').map((c) => c.trim()));
    const isSystem = cells.every((r) => r.length === 1) && cells.length > 1;
    const flat = cells.map((r) => (isSystem ? r[0]! : r.join(',')));
    const repl = rows.length > 1 && !isSystem ? `(${flat.join(',')})` : flat.join(',');
    s = `${s.slice(0, m.index)}${repl}${endIdx >= 0 ? s.slice(endIdx + endTag.length) : ''}`;
  }
  s = s.replace(/\\end\{[a-zA-Z*]+\}/g, '');
  // Text-ish environments collapse to their content.
  s = s.replace(/\\text|\\textbf|\\textit|\\mathrm|\\mathbf|\\mbox/g, ' ');
  return s;
}

function stripThousands(input: string): string {
  // 1,000 -> 1000 but keep 1,000,000 style and avoid touching "(1,2)" systems.
  return input.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
}

function normalizeRelationals(input: string): string {
  return input
    .replace(/≤|⩽/g, '<=')
    .replace(/≥|⩾/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/==/g, '=');
}

function normalizeSigns(input: string): string {
  // Treat "±" as "+" and "∓" as "-" inside expressions; the solution renderer
  // regenerates the proper \pm form for quadratic roots.
  return input.replace(/±/g, '+').replace(/∓/g, '-');
}

function collapseVerticalBars(input: string): string {
  // `|x|` -> abs(x), while leaving alone a bar that separates two relations
  // (such as the conditional bar in a piecewise definition).
  let s = input;
  let guard = 0;
  for (;;) {
    if (guard++ > 200) break;
    const open = s.indexOf('|');
    if (open < 0) break;
    if (s[open + 1] === '|') {
      // `||x||` — a norm; collapse to a single bar.
      s = `${s.slice(0, open)}${s.slice(open + 1)}`;
      continue;
    }
    const close = s.indexOf('|', open + 1);
    if (close < 0) {
      s = s.slice(0, open) + s.slice(open + 1);
      continue;
    }
    const body = s.slice(open + 1, close);
    if (body.length === 0 || /[=<>]/.test(body)) {
      s = s.slice(0, open) + s.slice(open + 1);
      continue;
    }
    s = `${s.slice(0, open)}abs(${body})${s.slice(close + 1)}`;
  }
  return s;
}

export function normalizeMathInput(raw: string): string {
  let s = raw;
  if (!s) return '';
  // Unicode mathematics operators.
  s = s.replace(/[\u2044]/g, '/');
  // Multiplication dots and the various dashes used as minus signs.
  s = s.replace(/\u00b7|\u2022|\u2219/g, '*');
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');
  s = s.replace(/[ \t]+/g, ' ');
  s = stripThousands(s);
  s = normalizeRelationals(s);
  s = expandDelimiters(s);
  s = expandGroupedCommands(s);
  s = expandSqrt(s);
  s = expandAbs(s);
  for (const [re, rep] of REPLACEMENTS) {
    s = typeof rep === 'function' ? s.replace(re, rep as (m: string) => string) : s.replace(re, rep);
  }
  s = normalizeSigns(s);
  s = expandScripts(s);
  s = collapseVerticalBars(s);
  s = s.replace(/degree/gi, 'deg');
  s = s.replace(/degrees?/gi, 'deg');
  s = s.replace(/\s*deg\b/gi, '°');
  s = s.replace(/\\circ/g, '°');
  s = s.replace(/\s*°/g, '°');
  s = s.replace(/[ ]{2,}/g, ' ');
  return s.trim();
}

export { collapseVerticalBars, expandSqrt, expandGroupedCommands, readGroup };
