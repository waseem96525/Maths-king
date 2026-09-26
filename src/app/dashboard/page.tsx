import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { HistoryList } from '@/components/history-list';
import { countProblems, listProblems, summarise } from '@/lib/history';

// The list changes whenever a problem is solved, so this page must render per
// request rather than being statically generated at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 50;

export default function DashboardPage() {
  // Read once, on the server. The page needs no client fetch to render, which
  // keeps first paint correct and avoids a loading flash on every visit.
  const problems = listProblems({ limit: PAGE_SIZE });
  const total = countProblems();
  const summary = summarise();

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

        <dl className="stagger mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Problems" value={summary.total} />
          <Stat label="Could not solve" value={summary.failures} tone={summary.failures > 0 ? 'warning' : 'default'} />
          <Stat label="Operations used" value={summary.byMode.length} />
          <Stat label="Most used" value={summary.byMode[0]?.mode ?? '—'} />
        </dl>

        <HistoryList initial={problems} total={total} />
      </main>

      <Footer />
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
