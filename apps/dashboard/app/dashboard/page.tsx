import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DashHeader } from "@/components/dashboard/DashBits";
import { UploadStats } from "@/components/dashboard/UploadStats";
import { PLATFORMS } from "@/lib/platforms";

export const metadata: Metadata = { title: "Dashboard" };

// ── Inline icons (match the Soft UI stat-card look) ──────────────────────────
const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "h-5 w-5" };
const ICONS: Record<string, React.ReactNode> = {
  grid: (<svg {...svg}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>),
  link: (<svg {...svg}><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>),
  puzzle: (<svg {...svg}><path d="M8 4a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H5v-3a2 2 0 1 1 0-4V4z" /></svg>),
  card: (<svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>),
  upload: (<svg {...svg}><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>),
  chart: (<svg {...svg}><path d="M4 20V4" /><path d="M4 20h16" /><rect x="8" y="12" width="3" height="5" /><rect x="14" y="8" width="3" height="9" /></svg>),
};

export default async function DashboardHome() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("designs")
    .select("id", { count: "exact", head: true });
  const productCount = count ?? 0;
  const livePlatforms = PLATFORMS.filter((p) => p.status === "live").length;

  // Every card links to a route that's still in the sidebar. Products,
  // platforms and subscription were removed from the nav, so pointing at them
  // from the home page would send people into pages the nav no longer offers a
  // way back from.
  const stats = [
    { label: "Products", value: String(productCount), sub: "in your library", href: "/dashboard/create", icon: "grid", grad: "su-grad-primary" },
    { label: "Live platforms", value: `${livePlatforms}/${PLATFORMS.length}`, sub: "TeePublic ready", href: "/dashboard/uploads", icon: "link", grad: "su-grad-success" },
    { label: "Extension", value: "Setup", sub: "Connect Chrome", href: "/dashboard/extension", icon: "puzzle", grad: "su-grad-info" },
    { label: "Sales & earnings", value: "Report", sub: "Upload your export", href: "/dashboard/analytics", icon: "chart", grad: "su-grad-warn" },
  ];

  const steps = [
    { t: "Create your first product", d: "Generate a listing with AI or import a spreadsheet.", href: "/dashboard/create", cta: "Create product" },
    { t: "Install the extension", d: "Add Higgstee to desktop Chrome and sign in.", href: "/dashboard/extension", cta: "Set up extension" },
    { t: "Upload to TeePublic", d: "Send your product to the extension and publish.", href: "/dashboard/uploads", cta: "Go to uploads" },
  ];

  return (
    <>
      <DashHeader title="Dashboard" subtitle="Your workspace at a glance.">
        <Link href="/dashboard/create" className="btn-primary">Create Product</Link>
      </DashHeader>

      {/* Upload volume — today / yesterday / 7d / 30d, from the get_upload_stats
          RPC. Client component: the buckets are resolved in the user's own
          timezone, which only the browser knows. */}
      <UploadStats />

      {/* Stat cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="su-card p-5 flex items-center justify-between transition hover:-translate-y-0.5"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{s.label}</p>
              <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{s.value}</p>
              <p className="mt-1 text-xs text-zinc-400 truncate">{s.sub}</p>
            </div>
            <span className={`su-icon ${s.grad}`}>{ICONS[s.icon]}</span>
          </Link>
        ))}
      </div>

      {/* Getting started + promo */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="su-card p-6 lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Getting started</h2>
          <ol className="mt-4 space-y-4">
            {steps.map((s, i) => (
              <li key={s.t} className="flex items-start gap-4">
                <span className="su-icon su-grad-primary !h-9 !w-9 text-sm font-bold">{i + 1}</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{s.t}</h3>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{s.d}</p>
                </div>
                <Link href={s.href} className="btn-ghost shrink-0 text-sm">{s.cta}</Link>
              </li>
            ))}
          </ol>
        </div>

        {/* Gradient promo card */}
        <div className="su-grad-dark relative overflow-hidden rounded-2xl p-6 flex flex-col" style={{ boxShadow: "var(--su-shadow)" }}>
          <span className="su-icon bg-white/15 !shadow-none">{ICONS.upload}</span>
          <h3 className="mt-4 text-lg font-bold text-white">Ready to upload?</h3>
          <p className="mt-1 text-sm text-white/70 flex-1">
            Prepared a product? Push it to the extension and publish to TeePublic in bulk.
          </p>
          <Link
            href="/dashboard/uploads"
            className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-95"
            style={{ color: "#0f172a" }}
          >
            Go to uploads
          </Link>
        </div>
      </div>
    </>
  );
}
