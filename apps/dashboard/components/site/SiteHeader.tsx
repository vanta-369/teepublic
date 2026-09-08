"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Logo } from "@/components/site/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PUBLIC_NAV } from "@/lib/nav";

// Marketing navbar. Floats as a full-width bar and, once the visitor scrolls,
// condenses into a narrower rounded "glass" pill (backdrop blur + translucent
// surface) — the tailark hero-header treatment, on Higgstee tokens. Stays
// `sticky` (not `fixed`) so it never overlaps content on the other pages that
// share this header. Sign In + Get Started stay visible at every breakpoint;
// when the visitor is signed in, the right side swaps to a Dashboard button.
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setSignedIn(!!d?.ok);
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full px-2 pt-2">
      <div
        className={clsx(
          "mx-auto flex items-center justify-between gap-4 px-4 transition-all duration-300",
          scrolled
            ? "h-14 max-w-5xl rounded-2xl border border-ink-700 bg-ink-900/70 shadow-card backdrop-blur-lg"
            : "h-16 max-w-7xl rounded-2xl border border-transparent",
        )}
      >
        <Logo />

        {/* Center links (desktop) */}
        <nav className="hidden md:flex items-center gap-1">
          {PUBLIC_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition",
                pathname === l.href
                  ? "text-accent-600 dark:text-accent-400 bg-ink-800"
                  : "text-zinc-500 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-ink-800",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* CTAs (always visible) */}
        <div className="flex items-center gap-2">
          <Link href="/download-extension" className="hidden sm:inline-flex btn-ghost">
            Download Extension
          </Link>
          <ThemeToggle />
          {signedIn ? (
            <Link href="/dashboard" className="btn-primary">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/signin" className="hidden sm:inline-flex btn-ghost">
                Sign In
              </Link>
              <Link href="/signup" className="btn-primary">
                Get Started
              </Link>
            </>
          )}
          <button
            type="button"
            className="md:hidden btn-ghost px-2.5"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              {open ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu — floating panel under the bar */}
      {open && (
        <nav className="md:hidden mx-auto mt-2 max-w-5xl rounded-2xl border border-ink-700 bg-ink-900/95 shadow-card backdrop-blur-lg p-3 flex flex-col gap-1">
          {PUBLIC_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-ink-800"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/download-extension"
            onClick={() => setOpen(false)}
            className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-ink-800"
          >
            Download Extension
          </Link>
          {!signedIn && (
            <Link
              href="/signin"
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-ink-800"
            >
              Sign In
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
