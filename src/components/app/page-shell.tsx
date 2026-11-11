import { cn } from "@/lib/utils";

/** Standard page frame for everything except the full-height review workspace. */
export function PageShell({ title, description, actions, children, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto w-full max-w-6xl px-6 py-6", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl text-foreground">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-lg leading-snug text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

export function Panel({ title, action, children, className, bodyClassName }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("glass-surface rounded-lg", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b px-7 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {action}
        </div>
      )}
      <div className={cn("px-7 py-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="glass-surface rounded-lg px-7 py-5">
      <div className="text-base font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass-surface px-8 py-12 text-center text-lg leading-snug text-muted-foreground", className)}>{children}</div>;
}
