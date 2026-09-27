# Maths King

Step-by-step maths, solved exactly. A Next.js app built on a from-scratch
symbolic engine that computes answers in exact rational arithmetic and shows the
working behind every one of them.

No API keys. No account. Nothing leaves the machine.

```bash
npm install
npm run dev        # http://localhost:3000
```

## What it does

| Operation | Coverage |
|---|---|
| **Solve** | Linear and quadratic equations, rational-root cubics, linear systems, linear inequalities |
| **Differentiate** | Product, quotient, chain, power and implicit rules |
| **Integrate** | Polynomials, powers, exponentials, logarithms, trig; adaptive Simpson for definite ranges with no closed form |
| **Simplify** | Expands products and small powers, collects like terms into one canonical form |
| **Evaluate** | Exact fractions where they exist, honest decimals where they do not |

Type in plain notation — `2x + 5 = 15`, `d/dx x^2 sin(x)`, `integrate 3x^2`,
`sin(30°)`, `x²`, `2×x`. An intent prefix selects the operation, or use the mode
buttons. With no prefix the shape of the input decides: an equation is solved, a
bare formula is differentiated.

### Scanning a problem

The camera button in the input row opens a live preview. Line the problem up in
the frame, take the photo, check it, and it is pinned next to the input so you
can type against it.

There is no OCR, and that is a decision rather than a gap. The only OCR accurate
on mathematical notation is either a paid cloud API or a local model large
enough to be its own product; both contradict the guarantee above. So the camera
does the thing a phone camera is genuinely good at — a crisp, correctly-oriented
image of the page in front of you — and you do the part that needs
understanding. The photo is re-encoded to a bounded JPEG in the tab and never
uploaded, so the promise holds exactly as it does for typed input.

## Design notes

**Exactness is a feature, not a slogan.** Answers are `Rational` values over
`BigInt`, so `1/3 + 1/6` is `1/2` and never `0.4999999`. When a result is
genuinely irrational the engine says so instead of laundering a float into a
fraction and calling it exact — `sin 30°` returns `1/2` by Niven's theorem, and
`sin 45°` is declined and flagged approximate.

**Every root is verified.** Before a solution is shown, each rational root is
substituted back into the original equation. An answer that does not satisfy
what was asked is discarded rather than rendered.

**No input can crash it.** The solver is total: every path returns a result, and
an unexpected engine fault becomes a reportable message rather than a 500 or an
unhandled rejection. Errors always carry a concrete next action.

**The history cannot be forged.** `POST /api/history` takes the *input*, never
the answer, and re-solves it server-side, so a modified client cannot insert
arbitrary LaTeX into stored results.

## Architecture

```
src/lib/math/      the engine — pure, dependency-free, no I/O
  rational.ts        exact BigInt fractions
  lexer/parser       text -> AST
  evaluate.ts        float and exact evaluation
  latex.ts           AST -> LaTeX and plain text
  simplify.ts        expansion and like-term collection
  differentiate.ts   symbolic differentiation
  integrate.ts       symbolic and numeric integration
  poly.ts            polynomial arithmetic
  solve.ts           equations, systems, inequalities, with steps
src/lib/solver.ts  orchestration: input -> mode -> explained answer
src/lib/db.ts      node:sqlite connection and migrations
src/lib/history.ts all SQL lives here
src/app/           routes and API
src/components/    UI
```

`src/lib/solver.ts` is pure and has no React, `fetch` or `process.env`, so the
browser and `POST /api/solve` run the identical code path. It executes in the
browser for instant answers, and behind the API for anything else.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm test` | Build the engine and run 317 assertions |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint via `next lint` |
| `npm run build` | Production build |
| `npm run db:reset` | Drop and rebuild the SQLite schema |
| `npm run db:seed` | Populate history by running the real solver |
| `npm run dbg` | Scratch bench for the engine |

The `db:*` scripts compile TypeScript first (`tsconfig.scripts.json` →
`.scripts/`) because Node cannot resolve the `@/` path alias.

## Data

SQLite at `./data/mathsking.db`, via Node's built-in `node:sqlite` — nothing to
install. Schema changes are append-only numbered migrations, each in its own
transaction. `npm run db:reset` refuses to run against a non-file
`DATABASE_URL`, so a hosted database cannot be dropped by accident.

`.env.example` documents the intended configuration. Copy it to `.env` only if
you need to change something; the app runs with no environment at all.

### Deploying to Vercel

The solver is pure, so it deploys to Vercel unchanged. **Problem history does
not**, because Vercel functions have a read-only filesystem apart from an
ephemeral `/tmp`, and each invocation may be a fresh instance with no shared
storage. SQLite cannot work there.

Rather than crash, the app detects this and disables history: `/dashboard`
explains that it is switched off, the history endpoints return `503` with a
reason, and solving is unaffected. It deliberately does **not** fall back to
in-memory storage, which would appear to work while losing data on every cold
start and disagreeing across concurrent instances.

All SQL lives behind the `HistoryStore` interface in `src/lib/store.ts`, so
adding a hosted database means writing one more implementation there. The
intended target is Postgres (Supabase); nothing above the seam changes.

## Status

Working: the engine, the solver UI, camera capture (no OCR, by design — see
above), problem history on a machine with a disk, the dashboard, the API.

Not built yet: hosted persistence (see above), accounts (Auth.js was the
intended choice), the AI tutor layer, OCR of scanned problems, and payments. The
offline engine is the only solving path today, which is why nothing here needs
an API key.

Known engine limits: `expand` over-expands denominator powers, fraction
arithmetic does not combine quotients, and cubic solving relies on rational roots
rather than the general formula.

## Requirements

Node 24+ (`node:sqlite` is stable from 24; `package.json` pins this so Vercel
does not fall back to an older runtime).
