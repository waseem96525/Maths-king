import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope } from 'next/font/google';

import './globals.css';
import 'katex/dist/katex.min.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Maths King — step-by-step maths, solved exactly',
  description:
    'Solve equations, differentiate, integrate and simplify with every step explained. Exact rational arithmetic, no account needed.',
  applicationName: 'Maths King',
  keywords: ['maths', 'math solver', 'algebra', 'calculus', 'step by step'],
  openGraph: {
    title: 'Maths King',
    description: 'Step-by-step maths, solved exactly.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1117' },
  ],
};

/**
 * Applies the stored theme before the first paint.
 *
 * This has to be a blocking inline script: any React that waits for an effect
 * runs after the browser has already painted the light background, which shows
 * up as a white flash for anyone who chose dark. The script is deliberately
 * tiny and dependency-free so it can be inlined, and it is wrapped in try/catch
 * because a browser with storage disabled should still get a usable page.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('maths-king-theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
