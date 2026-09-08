import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";

export const metadata: Metadata = { title: "Terms of Service" };

const SECTIONS = [
  {
    h: "Acceptance",
    p: "By requesting access to and using Higgstee, you agree to these terms. If you don't agree, don't use the service.",
  },
  {
    h: "The service",
    p: "Higgstee helps you prepare product listings and upload them to supported platforms via a browser extension. Access requires an approved account and, after the trial, an active plan.",
  },
  {
    h: "Acceptable use",
    p: "You are responsible for your content and for following each platform's own rules and terms. Don't use Higgstee to upload infringing, unlawful, or abusive content.",
  },
  {
    h: "Platform automation",
    p: "Higgstee automates actions in your browser on third-party platforms. Those platforms are independent and may change their sites or policies at any time, which can affect uploads. We provide the service on a best-effort basis.",
  },
  {
    h: "Accounts & termination",
    p: "We may suspend or terminate accounts that violate these terms or a platform's terms. You can stop using the service at any time.",
  },
  {
    h: "Disclaimer",
    p: "The service is provided “as is” without warranties. To the extent permitted by law, Higgstee is not liable for indirect or consequential damages.",
  },
];

export default function TermsPage() {
  return (
    <SiteShell>
      <PageHeader title="Terms of Service" subtitle="Last updated: July 24, 2026" />
      <section className="mx-auto max-w-3xl px-5 py-8 space-y-10">
        {SECTIONS.map((s) => (
          <div key={s.h}>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{s.h}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{s.p}</p>
          </div>
        ))}
      </section>
    </SiteShell>
  );
}
