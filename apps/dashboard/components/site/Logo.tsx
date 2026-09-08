import Link from "next/link";
import Image from "next/image";
import { BRAND } from "@/lib/nav";

// Higgstee wordmark + the brand mark (public/higgstee-mark.png — the same
// artwork the Chrome extension ships as its icon, so the site and the toolbar
// icon match). Replaced the earlier gradient "H" placeholder.
export function Logo({
  href = "/",
  subtitle,
}: {
  href?: string | null;
  subtitle?: string;
}) {
  const inner = (
    <span className="flex items-center gap-2.5">
      <Image
        src="/higgstee-mark.png"
        alt=""
        width={36}
        height={36}
        priority
        className="h-9 w-9 rounded-lg shadow-card"
      />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {BRAND}
        </span>
        {subtitle && <span className="text-xs text-zinc-400 mt-0.5">{subtitle}</span>}
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex" aria-label={BRAND}>
      {inner}
    </Link>
  );
}
