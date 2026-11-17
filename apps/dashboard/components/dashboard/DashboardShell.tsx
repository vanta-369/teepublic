"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Logo } from "@/components/site/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import {
  ChartColumn, Circle, CircleHelp, Clock, CreditCard, House, LayoutGrid, Link2, Plus, Puzzle, Settings, Upload, User, UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { DASHBOARD_NAV } from "@/lib/nav";

export interface AccessLite {
  email: string | null;
  plan: string;
  status: string;
  trialEnd: string | null;
  isAdmin: boolean;
}

// Sidebar icons: Lucide, one stroke weight throughout.
const ICONS: Record<string, LucideIcon> = {
  home: House, grid: LayoutGrid, plus: Plus, sparkle: UserRoundPlus, upload: Upload, clock: Clock, link: Link2,
  puzzle: Puzzle, card: CreditCard, user: User, gear: Settings, help: CircleHelp, chart: ChartColumn,
};

function Icon({ name }: { name: string }) {
  const Glyph = ICONS[name] ?? Circle;
  return <Glyph className="h-[17px] w-[17px]" strokeWidth={1.9} aria-hidden />;
}

function planChip(a: AccessLite) {
  if (a.isAdmin) return { label: "Admin", cls: "chip-info" };
  switch (a.status) {
    case "trialing": {
      if (a.trialEnd) {
        const days = Math.max(0, Math.ceil((new Date(a.trialEnd).getTime() - Date.now()) / 86_400_000));
        return { label: `Trial · ${days}d left`, cls: "chip-warn" };
      }
      return { label: "Trial", cls: "chip-warn" };
    }
    case "active": return { label: a.plan === "pro_yearly" ? "Pro (yearly)" : "Pro", cls: "chip-ok" };
    case "expired":
    case "cancelled": return { label: "Trial ended", cls: "chip-err" };
    default: return { label: a.status, cls: "chip-mute" };
  }
}

// Deepest matching nav label for the breadcrumb, longest-href first.
function currentCrumb(pathname: string): string {
  const match = [...DASHBOARD_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
  if (match) return match.label;
  const seg = pathname.split("/").filter(Boolean).pop() ?? "Dashboard";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function DashboardShell({ access, children }: { access: AccessLite; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const chip = planChip(access);
  const crumb = currentCrumb(pathname);
  // Create Product is a focused, step-by-step page: no top bar on desktop.
  // Phones keep it - it holds the only button that opens the sidebar.
  const bareTop = pathname === "/dashboard/create" || pathname.startsWith("/dashboard/create/");

  const sidebarInner = (
    <>
      <div className="px-5 pt-5 pb-4">
        <Logo />
      </div>
      <div className="mx-4 h-px bg-ink-700/70" />
      <nav className="su-nav flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {DASHBOARD_NAV.map((l) => {
          const active =
            l.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={clsx("su-navitem", active && "su-navitem-active")}
            >
              <span className="su-navicon">
                <Icon name={l.icon} />
              </span>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 space-y-3">
        <div className="su-grad-dark rounded-2xl p-4" style={{ boxShadow: "var(--su-shadow-sm)" }}>
          <p className="text-sm font-semibold text-white">Need the extension?</p>
          <p className="mt-1 text-xs text-white/70">Install Higgstee for Chrome to start uploading.</p>
          <Link
            href="/download-extension"
            onClick={() => setOpen(false)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25"
          >
            <Icon name="puzzle" /> Download
          </Link>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-zinc-400">Your plan</span>
          <span className={chip.cls}>{chip.label}</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="su-scope min-h-screen flex bg-ink-950">
      {/* Desktop floating sidebar */}
      <aside className="hidden md:block w-64 shrink-0 p-4">
        <div className="su-sidebar sticky top-4 flex h-[calc(100vh-2rem)] flex-col overflow-hidden">
          {sidebarInner}
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex p-3">
          <aside className="su-sidebar w-64 flex flex-col overflow-hidden h-full">{sidebarInner}</aside>
          <div className="flex-1" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed inset-0 -z-10 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Soft UI top navbar — transparent, breadcrumb + actions */}
        <header className={clsx("sticky top-0 z-30 px-4 md:px-6 pt-4", bareTop && "md:hidden")}>
          <div className="flex items-center gap-3 rounded-2xl bg-ink-950/70 px-2 py-1.5 backdrop-blur md:bg-transparent md:px-0 md:backdrop-blur-0">
            <button
              type="button"
              className="md:hidden su-navicon"
              aria-label="Menu"
              onClick={() => setOpen(true)}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="min-w-0">
              <p className="text-xs text-zinc-400">
                Pages <span className="px-0.5">/</span>
                <span className="text-zinc-600 dark:text-zinc-300"> {crumb}</span>
              </p>
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{crumb}</p>
            </div>

            <div className="flex-1" />

            <ThemeToggle />
            {access.isAdmin && (
              <Link href="/admin" className="btn-ghost">Admin</Link>
            )}
            {access.email && (
              <span className="chip-mute font-mono hidden lg:inline-flex" title={access.email}>
                {access.email}
              </span>
            )}
            <SignOutButton />
          </div>
        </header>

        <main className="flex-1 px-4 md:px-6 pb-10 pt-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
