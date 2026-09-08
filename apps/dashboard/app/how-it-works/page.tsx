import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader, CtaBand } from "@/components/site/PageBits";

export const metadata: Metadata = { title: "How It Works" };

const STEPS = [
  {
    n: "1",
    t: "Create a product",
    d: "Generate listings with AI or import a spreadsheet, add your artwork, and configure colors and product types — once.",
  },
  {
    n: "2",
    t: "Install & connect the extension",
    d: "Add the Higgstee extension to desktop Chrome and sign in with the same account. It links to your dashboard automatically.",
  },
  {
    n: "3",
    t: "Choose your platform",
    d: "Select TeePublic (live today) — Etsy, TPT, and Redbubble are coming soon. Your prepared product is reused for each.",
  },
  {
    n: "4",
    t: "Auto-upload",
    d: "Higgstee fills the platform's forms and publishes for you, one design at a time or in bulk, with human-like pacing.",
  },
  {
    n: "5",
    t: "Track your history",
    d: "Watch live progress and find every published listing — with its URL — in your upload history.",
  },
];

export default function HowItWorksPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="How it works"
        title="From design to published listing"
        subtitle="Prepare a product once, then let the browser extension do the uploading."
      />
      <section className="mx-auto max-w-3xl px-5 py-8">
        <div className="divide-y divide-ink-700">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-5 py-6 first:pt-0 last:pb-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-500 font-bold text-zinc-950">
                {s.n}
              </span>
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{s.t}</h3>
                <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-8">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Why an extension?</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Uploading to POD platforms happens in your browser, on the platform&apos;s own
            pages. The Higgstee extension drives those pages for you using your existing
            platform login — so your credentials never pass through us.
          </p>
        </div>
      </section>
      <CtaBand />
    </SiteShell>
  );
}
