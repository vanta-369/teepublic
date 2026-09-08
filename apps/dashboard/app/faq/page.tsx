import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";

export const metadata: Metadata = { title: "FAQ" };

const GROUPS: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: "General",
    items: [
      { q: "What is Higgstee?", a: "A tool that helps print-on-demand sellers prepare a product once and auto-upload it to multiple platforms using a browser extension." },
      { q: "Which platforms are supported?", a: "TeePublic is live today. Etsy, Teachers Pay Teachers, and Redbubble are coming soon." },
    ],
  },
  {
    title: "Extension",
    items: [
      { q: "Do I need the extension?", a: "Yes — uploads happen in your browser on each platform's pages, so the extension is required to publish." },
      { q: "Which browsers work?", a: "Desktop Chrome (and Chromium-based browsers). The extension is not available on mobile." },
      { q: "Are my platform passwords sent to Higgstee?", a: "No. The extension uses your existing platform login in your own browser; your credentials never pass through us." },
    ],
  },
  {
    title: "Access & billing",
    items: [
      { q: "How do I get access?", a: "Request access, verify your email, and an admin approves your account — then your free trial starts." },
      { q: "How do I upgrade to Pro?", a: "Contact us and we'll enable Pro on your account." },
    ],
  },
];

export default function FaqPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="FAQ"
        title="Frequently asked questions"
        subtitle="Everything you need to know about Higgstee, access, and the extension."
      />
      <section className="mx-auto max-w-3xl px-5 py-8 space-y-12">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h2 className="label mb-5">{g.title}</h2>
            <div className="space-y-8">
              {g.items.map((it) => (
                <div key={it.q}>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{it.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{it.a}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-center text-sm text-zinc-500">
          Still need help?{" "}
          <Link href="/contact" className="text-accent-500 hover:text-accent-400">Contact us</Link>.
        </p>
      </section>
    </SiteShell>
  );
}
