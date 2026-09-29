import type { ReactNode } from 'react';

/**
 * Small presentational pieces shared by the screens.
 *
 * They are deliberately plain: a `div` with a class name. Anything with state or
 * data fetching is a screen, and lives with the feature it belongs to.
 */

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      {title !== undefined && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h2>
            {subtitle !== undefined && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'accent';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    accent: 'bg-accent-500/15 text-accent-400 ring-accent-500/30',
    neutral: 'bg-white/5 text-slate-300 ring-white/10',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Meter({ percentUsed, exhausted }: { percentUsed: number; exhausted: boolean }) {
  const width = Math.max(2, Math.min(100, percentUsed));
  const colour = exhausted ? 'bg-rose-400' : width > 75 ? 'bg-amber-400' : 'bg-accent-500';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuenow={Math.round(percentUsed)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/5 ${className}`} aria-hidden="true" />;
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'bad' | 'ok' | 'warn';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-white/10 bg-white/5 text-slate-300',
    bad: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role={tone === 'bad' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
