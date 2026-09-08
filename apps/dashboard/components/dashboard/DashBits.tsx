import Link from "next/link";

export function DashHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`surface p-6 ${className}`}>{children}</div>;
}

export function EmptyState({
  title,
  subtitle,
  actionLabel,
  actionHref,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="surface-soft border-dashed p-10 text-center">
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {subtitle && <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-primary mt-5">{actionLabel}</Link>
      )}
    </div>
  );
}
