import Link from 'next/link';
import { ArrowLeft, Database } from 'lucide-react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { HistoryList } from '@/components/history-list';
import { getStore } from '@/lib/store';

// The list changes whenever a problem is solved, so this page must render per
// request rather than being statically generated at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 50;

export default function DashboardPage() {
  // Read once, on the server. The page needs no client fetch to render, which
  // keeps first paint correct and avoids a loading flash on every visit.
  const store = getStore();
  const problems = store.list({ limit: PAGE_SIZE });
  const total = store.count();
  const summary = store.summary();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the solver
        </Link>

        <h1 className="mt-4 text-3xl font-bold tracking-tight">History</h1>
        <p className="mt-1.5 text-muted-foreground">
          Every problem solved on this machine, newest first. Answers are stored exactly as the engine
          produced them.
        </p>

        {store.available ? (
          <>
            <dl className="stagger mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Problems" value={summary.total} />
              <Stat
                label="Could not solve"
                value={summary.failures}
                tone={summary.failures > 0 ? 'warning' : 'default'}
              />
              <Stat label="Operations used" value={summary.byMode.length} />
              <Stat label="Most used" value={summary.byMode[0]?.mode ?? '—'} />
            </dl>

            <HistoryList initial={problems} total={total} />
          </>
        ) : (
          <Unavailable reason={store.reason} />
        )}
      </main>

      <Footer />
    </div>
  );
}

/**
 * Shown when there is nowhere to store history. This is a supported state, not
 * a failure, so it explains itself and points at what still works.
 */
function Unavailable({ reason }: { reason: string | null }) {
  return (
    <div className="surface mt-8 rounded-2xl p-8 text-center shadow-sm">
      <Database className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 font-semibold">History is switched off here</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        {reason ?? 'There is no writable database available in this environment.'}
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        Solving works exactly as normal — only the saved list is unavailable. Add a database and this
        page fills in on its own.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Go to the solver
      </Link>
    </div>
  );
}
function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="surface rounded-xl p-4 shadow-xs">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === 'warning'
            ? 'mt-1 text-2xl font-semibold text-warning'
            : 'mt-1 text-2xl font-semibold tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}
