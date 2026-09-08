"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CircleHelp,
  Clock,
  CreditCard,
  Grid2x2,
  HelpCircle,
  Home,
  Link2,
  Plus,
  Puzzle,
  Settings,
  Upload,
  User,
} from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { BRAND, DASHBOARD_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

// `lib/nav.ts` stores an icon *key* per link so the nav config stays free of
// JSX; this is the one place those keys become components.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  grid: Grid2x2,
  plus: Plus,
  upload: Upload,
  clock: Clock,
  link: Link2,
  puzzle: Puzzle,
  card: CreditCard,
  user: User,
  gear: Settings,
  help: HelpCircle,
  chart: BarChart3,
};

/**
 * Standalone sidebar for the `EfferdDashboard2` composition.
 *
 * The in-app route at /dashboard/analytics does NOT use this — it renders
 * inside the app's existing `DashboardShell`, which already provides the
 * sidebar. Mounting both would give the page two navs.
 */
export function DashboardSidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden w-60 shrink-0 flex-col gap-1 rounded-2xl bg-ink-900 p-3 shadow-card lg:flex dark:border dark:border-ink-700",
        className,
      )}
    >
      <div className="px-3 py-3">
        <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {BRAND}
        </span>
      </div>
      <Separator className="mb-2" />

      <nav aria-label="Dashboard" className="flex flex-col gap-0.5">
        {DASHBOARD_NAV.map((link) => {
          const Icon = ICONS[link.icon] ?? CircleHelp;
          // Exact match for the root so /dashboard isn't "active" on every page.
          const active =
            link.href === "/dashboard" ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                active
                  ? "bg-ink-800 font-semibold text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-600 hover:bg-ink-800/70 dark:text-zinc-300",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
