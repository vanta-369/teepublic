import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader, CtaBand } from "@/components/site/PageBits";
import { PLATFORMS, STATUS_LABEL } from "@/lib/platforms";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="About"
        title="Built for print-on-demand sellers"
        subtitle="Higgstee removes the repetitive work of uploading the same product to every marketplace."
      />
      <section className="mx-auto max-w-3xl px-5 py-8 space-y-10">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Our mission</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Sellers spend hours copying titles, tags, and images across platforms. We
            believe you should prepare a product once and publish it everywhere — so you
            can spend your time creating, not uploading.
          </p>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">What Higgstee does</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            A dashboard to prepare products (with AI-assisted listings) plus a browser
            extension that fills in and publishes them on the platforms you choose.
          </p>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Supported platforms</h3>
          <ul className="mt-3 space-y-2">
            {PLATFORMS.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-zinc-700 dark:text-zinc-200">{p.name}</span>
                <span className={p.status === "live" ? "chip-ok" : "chip-mute"}>
                  {STATUS_LABEL[p.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <CtaBand />
    </SiteShell>
  );
}
