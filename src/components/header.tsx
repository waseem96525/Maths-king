import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          >
            ∑
          </span>
          <span>Maths King</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            History
          </Link>
          <Link
            href="/#what-it-can-do"
            className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
          >
            Capabilities
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
