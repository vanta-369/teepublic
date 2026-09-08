import Link from "next/link";
import clsx from "clsx";
import { PLATFORMS, STATUS_LABEL, type Platform } from "@/lib/platforms";

// Landing "supported platforms" section. The cards are styled to LOOK like
// drag-and-drop zones — this is a visual metaphor only; they are NOT interactive
// file-drop targets. Real product input happens on /dashboard/create.
function UploadGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function Card({ p }: { p: Platform }) {
  const live = p.status === "live";
  const body = (
    <div
      className={clsx(
        "surface-soft border-dashed p-6 h-full flex flex-col gap-4 transition text-left",
        live
          ? "hover:-translate-y-1 hover:border-accent-500/60 hover:shadow-card cursor-pointer"
          : "opacity-70",
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={clsx(
            "h-12 w-12 rounded-lg grid place-items-center font-bold text-lg border",
            p.tileClass,
          )}
        >
          {p.initial}
        </span>
        <span className={clsx("grid place-items-center h-9 w-9 rounded-lg border border-ink-700 text-zinc-400", live && "text-accent-500")}>
          <UploadGlyph />
        </span>
      </div>
      <div className="space-y-1.5 flex-1">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{p.name}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{p.short}</p>
      </div>
      <span className={live ? "chip-ok" : "chip-mute"}>{STATUS_LABEL[p.status]}</span>
    </div>
  );

  return live ? (
    <Link href="/signup" className="block h-full">
      {body}
    </Link>
  ) : (
    <div className="h-full">{body}</div>
  );
}

export function PlatformCards() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <span className="chip-info mb-3">Supported platforms</span>
        <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Prepare once. Upload to the platform you choose.
        </h2>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          Build a product a single time, then send it to any connected platform. These
          cards are a visual guide — you prepare products inside your dashboard.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PLATFORMS.map((p) => (
          <Card key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}
