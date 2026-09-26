export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Maths King — an offline exact engine with every step shown.</p>
        <p className="font-mono text-xs">
          Answers are verified against the original expression before they are shown.
        </p>
      </div>
    </footer>
  );
}
