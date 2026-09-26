'use client';

import katex from 'katex';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

/**
 * Render a LaTeX fragment.
 *
 * The engine is the only source of these strings and it escapes anything that
 * came from the user, so there is no untrusted markup reaching the DOM here.
 * `throwOnError: false` means a fragment KaTeX cannot parse degrades to its
 * source text rather than blanking the answer, and `aria-label` carries the
 * plain-text form so a screen reader announces the maths, not the markup.
 */
export function Math({
  latex,
  display = false,
  className,
  label,
}: {
  latex: string;
  /** Block display for a headline answer, inline for steps. */
  display?: boolean;
  className?: string;
  /** Plain-text alternative announced in place of the rendered maths. */
  label?: string;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
      });
    } catch {
      return null;
    }
  }, [latex, display]);

  if (html === null) {
    return <span className={cn('font-mono text-sm', className)}>{latex}</span>;
  }

  return (
    <span
      className={cn(display ? 'math-block' : 'math-inline', className)}
      aria-label={label}
      // KaTeX output is generated locally from engine-escaped input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
