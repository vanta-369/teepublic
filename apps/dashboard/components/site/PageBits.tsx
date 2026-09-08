import Link from "next/link";

// Shared marketing building blocks so public pages stay visually consistent.

export function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 pt-16 pb-6 text-center">
      {eyebrow && <span className="chip-info mb-4">{eyebrow}</span>}
      <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h1>
      {subtitle && <p className="mt-4 text-lg text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
    </div>
  );
}

export function CtaBand({
  title = "Ready to automate your uploads?",
  subtitle = "Request access and connect the extension in minutes.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="surface p-10 text-center bg-grad-accent">
        <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-white/80">{subtitle}</p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <Link href="/signup" className="btn bg-white text-accent-700 hover:brightness-95 px-6 py-3 text-base">
            Get Started Now
          </Link>
          <Link href="/download-extension" className="btn bg-white/15 text-white border border-white/30 hover:bg-white/25 px-6 py-3 text-base">
            Download Extension
          </Link>
        </div>
      </div>
    </section>
  );
}
