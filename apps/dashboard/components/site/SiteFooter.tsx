import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import {
  BRAND,
  BRAND_TAGLINE,
  FOOTER_PRODUCT,
  FOOTER_COMPANY,
  FOOTER_LEGAL,
} from "@/lib/nav";

function Column({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="label mb-3">{title}</p>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-accent-500">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-700 mt-20">
      <div className="mx-auto max-w-7xl px-5 py-12 grid gap-10 md:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-zinc-500 max-w-xs">{BRAND_TAGLINE}</p>
        </div>
        <Column title="Product" links={FOOTER_PRODUCT} />
        <Column title="Company" links={FOOTER_COMPANY} />
        <Column title="Legal" links={FOOTER_LEGAL} />
      </div>
      <div className="border-t border-ink-700">
        <div className="mx-auto max-w-7xl px-5 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <span>
            © {new Date().getFullYear()} {BRAND}. All rights reserved.
          </span>
          <span className="flex gap-4">
            <Link href="/signin" className="hover:text-accent-500">Sign In</Link>
            <Link href="/signup" className="hover:text-accent-500">Get Started</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
