'use client';

import { AlertCircle, Check, CornerDownLeft, Lightbulb, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

import { CameraScan, CapturedPhoto } from '@/components/camera-scan';
import { Math } from '@/components/math';
import type { CapturedShot } from '@/lib/image';
import { EXAMPLES, solve, type SolveMode, type SolveResult } from '@/lib/solver';
import { cn } from '@/lib/utils';

const MODES: ReadonlyArray<{ value: SolveMode; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Work it out from what you typed' },
  { value: 'solve', label: 'Solve', hint: 'Equations, systems and inequalities' },
  { value: 'differentiate', label: 'Differentiate', hint: 'Find a rate of change' },
  { value: 'integrate', label: 'Integrate', hint: 'Find an antiderivative or an area' },
  { value: 'simplify', label: 'Simplify', hint: 'Expand and collect terms' },
  { value: 'evaluate', label: 'Evaluate', hint: 'Work out a single value' },
];

export function Solver() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SolveMode>('auto');
  const [result, setResult] = useState<SolveResult | null>(null);
  /** Id of the stored row, once the server confirms it. */
  const [recorded, setRecorded] = useState<number | null>(null);
  /** The scanned photo, held only in this tab. Never uploaded. */
  const [shot, setShot] = useState<CapturedShot | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The solver is a pure function over an exact engine, so it runs right here
   * in the browser: no network round trip, and the identical code path the API
   * route exposes for anything else. The engine is small enough that this stays
   * instant even on a long expression.
   */
  const run = useCallback((text: string, chosen: SolveMode) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResult(null);
      return;
    }
    const solved = solve({ input: trimmed, mode: chosen });
    setResult(solved);
    setRecorded(null);
    // Recording is a side effect of answering, so it must not be able to delay
    // or break the answer. The server re-solves from the input, so this cannot
    // be trusted with the rendered answer.
    void fetch('/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: trimmed, mode: chosen }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { id: number }) => setRecorded(data.id))
      .catch(() => setRecorded(null));
  }, []);

  function submit(text: string, chosen: SolveMode) {
    setInput(text);
    setMode(chosen);
    run(text, chosen);
  }

  const activeMode = MODES.find((m) => m.value === mode)!;
  const canSubmit = input.trim().length > 0;

  return (
    <section className="w-full" aria-label="Maths solver">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(input, mode);
        }}
        className="surface rounded-2xl p-3 shadow-md sm:p-4"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Operation">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={mode === m.value}
                onClick={() => {
                  setMode(m.value);
                  // Re-run immediately so switching mode on an existing
                  // expression reinterprets it, rather than waiting for submit.
                  run(input, m.value);
                }}
                title={m.hint}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mode === m.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <label htmlFor="solver-input" className="sr-only">
              Maths problem
            </label>
            <input
              id="solver-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="2x + 5 = 15"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-describedby="solver-hint"
              className={cn(
                // Room for the camera button and the submit button, which both
                // float inside the field's right edge.
                'w-full rounded-xl border border-input bg-background px-4 py-3.5 pr-[6.25rem]',
                'font-mono text-base text-foreground placeholder:text-muted-foreground/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
              )}
            />
            <CameraScan onCapture={setShot} shot={shot} closeFocusRef={inputRef} />
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-primary p-2 text-primary-foreground',
                'transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
              aria-label="Solve"
            >
              <CornerDownLeft className="size-4" aria-hidden />
            </button>
          </div>

          {shot !== null ? <CapturedPhoto shot={shot} onClear={() => setShot(null)} /> : null}

          <div id="solver-hint" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{activeMode.hint}.</span>
            <span>Try</span>
            {EXAMPLES.slice(0, 3).map((ex, i) => (
              <span key={ex.input} className="flex items-center gap-x-2">
                <button
                  type="button"
                  onClick={() => submit(ex.input, ex.mode)}
                  className="font-mono text-foreground underline underline-offset-2 hover:text-primary"
                >
                  {ex.input}
                </button>
                {i < 2 ? <span aria-hidden>,</span> : null}
              </span>
            ))}
          </div>
        </div>
      </form>

      <div aria-live="polite" className="mt-4">
        {result === null ? null : <Result result={result} recordedId={recorded} />}
      </div>
    </section>
  );
}

function Result({ result, recordedId }: { result: SolveResult; recordedId: number | null }) {
  if (!result.ok) {
    return (
      <div className="surface rounded-2xl border-l-4 border-l-destructive p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-foreground">{result.error}</p>
            {result.hint ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{result.hint}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stagger flex flex-col gap-3">
      <div className="surface rounded-2xl p-5 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {result.title}
          </h2>
          {result.approximate ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
              approximate
            </span>
          ) : null}
        </div>
        <div className="mt-3 overflow-x-auto">
          <Math latex={result.answerLatex} display label={result.answerPlain} />
        </div>
        {/* The plain-text form is the copyable, screen-readable answer; KaTeX
            output is visual only. */}
        <p className="mt-3 select-all border-t border-border pt-3 font-mono text-xs text-muted-foreground">
          {result.answerPlain}
        </p>
      </div>

      {result.steps.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {result.steps.map((step, i) => (
            <li key={i} className="surface rounded-xl p-4 shadow-xs">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {step.title ? <p className="text-sm font-semibold text-foreground">{step.title}</p> : null}
                  <div className="mt-1 overflow-x-auto">
                    <Math latex={step.latex} />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{step.why}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3" aria-hidden />
          Solved with the {result.mode} engine, exactly.
        </span>
        {recordedId !== null ? (
          <span className="flex items-center gap-1.5 text-success">
            <Check className="size-3" aria-hidden />
            <Link href="/dashboard" className="underline underline-offset-2 hover:opacity-80">
              Saved to history
            </Link>
          </span>
        ) : null}
      </p>
    </div>
  );
}
