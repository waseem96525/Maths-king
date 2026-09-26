import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Solver } from '@/components/solver';
import { CAPABILITIES } from '@/lib/solver';

const ASSURANCES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Exact, not rounded',
    body: 'Answers are computed as fractions. 1/3 + 1/6 is 1/2, not 0.4999999, and you are told plainly when a result can only be a decimal.',
  },
  {
    title: 'Every step shown',
    body: 'The working is the product. Each step carries the reason it was taken, so an answer you cannot follow is an answer you cannot trust.',
  },
  {
    title: 'Runs offline',
    body: 'The whole engine is local and deterministic, with no account, no quota and no request that leaves your machine.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="grid-bg absolute inset-0" aria-hidden />
          <div className="relative mx-auto w-full max-w-3xl px-4 pb-10 pt-12 sm:pt-20">
            <div className="stagger flex flex-col items-center text-center">
              <h1 className="text-gradient text-4xl font-bold tracking-tight sm:text-5xl">
                Maths, solved step by step
              </h1>
              <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
                Equations, calculus and algebra with the working shown. Exact answers, no account, nothing
                sent anywhere.
              </p>
            </div>

            <div className="mt-8 sm:mt-10">
              <Solver />
            </div>
          </div>
        </section>

        <section id="what-it-can-do" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-12 sm:py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight">What it can do</h2>
          <div className="stagger mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="surface rounded-2xl p-5 shadow-sm">
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-16">
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Built to be checked
            </h2>
            <div className="stagger mt-8 grid gap-4 sm:grid-cols-3">
              {ASSURANCES.map((a) => (
                <div key={a.title} className="rounded-2xl bg-card p-5 shadow-xs">
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
