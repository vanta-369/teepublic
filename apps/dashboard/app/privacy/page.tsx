import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";

export const metadata: Metadata = { title: "Privacy Policy" };

const SECTIONS = [
  {
    h: "What we collect",
    p: "Your account email and authentication data, the products and listings you create, and the images you upload for your listings. We do not collect your passwords for TeePublic, Etsy, TPT, or Redbubble.",
  },
  {
    h: "Platform credentials",
    p: "Uploads run in your own browser through the Higgstee extension, using your existing login on each platform. Your platform credentials are never sent to or stored by Higgstee.",
  },
  {
    h: "How we use your data",
    p: "To provide the service: authenticate you, store your products so they follow your account, and let the extension upload on your behalf. We do not sell your data.",
  },
  {
    h: "Storage & security",
    p: "Account data and product images are stored with our infrastructure provider (Supabase) and scoped to your account. Access is restricted to you and, where necessary, our administrators.",
  },
  {
    h: "Your choices",
    p: "You can delete your products at any time and request account deletion by contacting us.",
  },
];

export default function PrivacyPage() {
  return (
    <SiteShell>
      <PageHeader title="Privacy Policy" subtitle="Last updated: July 24, 2026" />
      <section className="mx-auto max-w-3xl px-5 py-8 space-y-10">
        {SECTIONS.map((s) => (
          <div key={s.h}>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{s.h}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{s.p}</p>
          </div>
        ))}
        <p className="text-sm text-zinc-500">
          Questions? Email us via the <a href="/contact" className="text-accent-500 hover:text-accent-400">contact page</a>.
        </p>
      </section>
    </SiteShell>
  );
}
