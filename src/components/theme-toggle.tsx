'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'maths-king-theme';

/**
 * A theme toggle without `next-themes`.
 *
 * The theme has to be applied before first paint to avoid a flash of the wrong
 * colours, which is normally the job of an inline script in the document head.
 * That is done in `layout.tsx`; this component only reflects and changes the
 * state afterwards, and starts out neutral so the server and client markup
 * match on the very first render.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse to store. The toggle still works for this
      // session, which is better than failing the interaction.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'touch-target inline-flex size-9 items-center justify-center rounded-lg',
        'text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
      // Until the effect runs there is no single correct icon to show, so
      // nothing is rendered rather than a guess that would flip on mount.
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="size-4.5" aria-hidden /> : <Moon className="size-4.5" aria-hidden />}
    </button>
  );
}
