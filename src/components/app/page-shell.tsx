import { cn } from "@/lib/utils";

/** Standard page frame for everything except the full-height review workspace. */
export function PageShell({ title, description, actions, children, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto w-full max-w-6xl px-6 py-6", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

export function Panel({ title, action, children, className, bodyClassName }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-xl border bg-white", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {action}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-dashed bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500", className)}>{children}</div>;
}
