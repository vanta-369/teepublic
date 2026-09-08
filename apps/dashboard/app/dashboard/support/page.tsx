import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader, Card } from "@/components/dashboard/DashBits";

export const metadata: Metadata = { title: "Support" };

const LINKS = [
  { t: "FAQ", d: "Answers to common questions.", href: "/faq" },
  { t: "Install the extension", d: "Set up and connect the browser extension.", href: "/download-extension" },
  { t: "Extension connection", d: "Check or fix your extension connection.", href: "/dashboard/extension" },
];

export default function SupportPage() {
  return (
    <>
      <DashHeader title="Support" subtitle="Get help using Higgstee." />
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {LINKS.map((l) => (
          <Link key={l.t} href={l.href} className="surface p-6 hover:border-accent-500/50 transition">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{l.t}</h3>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{l.d}</p>
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Still need help?</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Reach out and we&apos;ll get back to you.
        </p>
        <Link href="/contact" className="btn-primary mt-4">Contact us</Link>
      </Card>
    </>
  );
}
