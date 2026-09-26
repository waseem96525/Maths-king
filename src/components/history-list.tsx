'use client';

import { CheckCircle2, Search, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

import { Math } from '@/components/math';
import type { ProblemRecord } from '@/lib/history';
import { cn } from '@/lib/utils';

/**
 * The stored problems, with search, filtering and deletion.
 *
 * The first page arrives as server-rendered HTML so the list is readable
 * without JavaScript; everything after that is client state. Deletion is applied
 * optimistically and rolled back if the server refuses, because a delete button
 * that does nothing is worse than one that briefly shows the wrong state.
 */
export function HistoryList({ initial, total }: { initial: ProblemRecord[]; total: number }) {
  const [problems, setProblems] = useState(initial);
  const [search, setSearch] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return problems.filter((p) => {
      if (onlyFailures && p.ok) return false;
      if (!needle) return true;
      return (
        p.input.toLowerCase().includes(needle) || (p.answerPlain ?? '').toLowerCase().includes(needle)
      );
    });
  }, [problems, search, onlyFailures]);

  function remove(id: number) {
    const previous = problems;
    setProblems((rows) => rows.filter((r) => r.id !== id));
    void fetch(`/api/history/${id}`, { method: 'DELETE' }).then((res) => {
      if (!res.ok) {
        setProblems(previous);
        return;
      }
      startTransition(() => {});
    });
  }

  function clearAll() {
    if (!confirm(`Delete all ${problems.length} stored problems? This cannot be undone.`)) return;
    const previous = problems;
    setProblems([]);
    void fetch('/api/history', { method: 'DELETE' }).then((res) => {
      if (!res.ok) setProblems(previous);
      startTransition(() => {});
    });
  }

  if (total === 0) {
    return (
      <div className="surface mt-8 rounded-2xl p-10 text-center shadow-sm">
        <p className="font-medium">Nothing solved yet</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          Problems you solve are saved here automatically, with the full working.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="history-search" className="sr-only">
            Search history
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id="history-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inputs and answers"
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          Unsolved only
        </label>

        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="size-4" aria-hidden />
          Clear all
        </button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {filtered.length} of {problems.length} loaded
        {problems.length < total ? ` (${total} stored in total)` : ''}
        {pending ? ' — updating…' : ''}
      </p>

      {filtered.length === 0 ? (
        <p className="surface mt-4 rounded-xl p-6 text-center text-sm text-muted-foreground">
          Nothing matches that search.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-2">
          {filtered.map((p) => (
            <li key={p.id} className="surface rounded-xl p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{p.input}</code>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                      {p.mode}
                    </span>
                    {p.ok ? (
                      <CheckCircle2 className="size-4 text-success" aria-label="Solved" />
                    ) : (
                      <XCircle className="size-4 text-destructive" aria-label="Could not solve" />
                    )}
                  </div>

                  {p.ok && p.answerLatex ? (
                    <div className="mt-2 overflow-x-auto">
                      <Math latex={p.answerLatex} label={p.answerPlain ?? undefined} />
                    </div>
                  ) : null}
                  {!p.ok && p.error ? (
                    <p className="mt-2 text-sm text-destructive">{p.error}</p>
                  ) : null}
                  {p.ok && p.answerPlain ? (
                    <p className="mt-1.5 select-all font-mono text-xs text-muted-foreground">{p.answerPlain}</p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label={`Delete ${p.input}`}
                  className={cn(
                    'shrink-0 rounded-lg p-2 text-muted-foreground transition-colors',
                    'hover:bg-destructive/10 hover:text-destructive',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
