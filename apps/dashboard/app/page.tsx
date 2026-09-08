import Link from "next/link";
import {
  Sparkles,
  Layers,
  UploadCloud,
  FileSpreadsheet,
  ShieldCheck,
  RefreshCw,
  Globe,
  Wand2,
  Check,
  ArrowRight,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { HeroLanding } from "@/components/site/HeroLanding";

export default function HomePage() {
  return (
    <SiteShell>
      <HeroLanding />
      <StatsBand />
      <Features />
      <HighlightPrepare />
      <HighlightGenerate />
      <HowItWorks />
      <FinalCta />
    </SiteShell>
  );
}

// ── Stats band ───────────────────────────────────────────────────────────────
function StatsBand() {
  const stats = [
    { n: "4", l: "Platforms supported" },
    { n: "1-click", l: "Bulk upload queue" },
    { n: "Minutes", l: "Not hours per batch" },
    { n: "100%", l: "Your account, everywhere" },
  ];
  return (
    <section className="mx-auto max-w-7xl px-5 py-10">
      <div className="soft-band grid gap-6 rounded-2xl border border-ink-700 p-8 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l} className="text-center">
            <div className="text-3xl font-extrabold tracking-tight text-accent-600 dark:text-accent-400 sm:text-4xl">
              {s.n}
            </div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Features grid ────────────────────────────────────────────────────────────
function Features() {
  const items = [
    {
      icon: Wand2,
      t: "AI-generated listings",
      d: "Titles, descriptions, and tags written for you in seconds with your own Gemini key.",
    },
    {
      icon: FileSpreadsheet,
      t: "Spreadsheet import",
      d: "Drop in an .xlsx or .csv, match artwork by filename, and preview before you push.",
    },
    {
      icon: Layers,
      t: "Bulk uploads",
      d: "Queue dozens of designs and let the extension publish them one after another.",
    },
    {
      icon: RefreshCw,
      t: "Self-healing automation",
      d: "Interrupted mid-upload? Items resume automatically — nothing gets published twice.",
    },
    {
      icon: Globe,
      t: "Prepare once, sell everywhere",
      d: "Reuse a single product across every platform you sell on. No re-entering details.",
    },
    {
      icon: ShieldCheck,
      t: "Secure by design",
      d: "Access is verified live on every action. Your API key never leaves your browser.",
    },
  ];
  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <span className="eyebrow">
          <Sparkles className="size-3.5" /> Features
        </span>
        <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
          Everything you need to publish faster
        </h2>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          From artwork to a live listing — Higgstee handles the busywork so you can focus on
          designs, not data entry.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, t, d }) => (
          <div key={t} className="feat-card">
            <span className="feat-icon">
              <Icon className="size-6" />
            </span>
            <h3 className="mt-5 font-semibold text-zinc-900 dark:text-zinc-100">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Alternating highlight sections ───────────────────────────────────────────
function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((i) => (
        <li key={i} className="check-row">
          <span className="check-dot">
            <Check className="size-3" strokeWidth={3} />
          </span>
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

function HighlightPrepare() {
  return (
    <section className="soft-band border-y border-ink-700">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-20">
        {/* Visual */}
        <div className="order-2 lg:order-1">
          <div className="hero-panel mx-auto max-w-md">
            <div className="rounded-xl border border-ink-700 bg-ink-950 p-5">
              <div className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                One product → four platforms
              </div>
              <div className="space-y-3">
                {[
                  { n: "TeePublic", s: "chip-ok", l: "Published" },
                  { n: "Etsy", s: "chip-info", l: "Queued" },
                  { n: "Teachers Pay Teachers", s: "chip-warn", l: "Uploading" },
                  { n: "Redbubble", s: "chip-mute", l: "Draft" },
                ].map((r) => (
                  <div
                    key={r.n}
                    className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5"
                  >
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{r.n}</span>
                    <span className={`${r.s} !py-0.5 !text-[11px]`}>{r.l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* Copy */}
        <div className="order-1 lg:order-2">
          <span className="eyebrow">
            <Globe className="size-3.5" /> Prepare once
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
            Build a product a single time
          </h2>
          <p className="mt-3 text-zinc-500 dark:text-zinc-400">
            Enter your title, description, tags, and artwork once. Higgstee stores it with your
            account and reuses it for every platform — so you never re-type the same listing.
          </p>
          <CheckList
            items={[
              "Products follow your account across browsers",
              "Match artwork to rows automatically by filename",
              "Validate and preview before anything is published",
            ]}
          />
          <Link href="/how-it-works" className="btn-ghost mt-8 gap-2">
            See how it works <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function HighlightGenerate() {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-20">
      {/* Copy */}
      <div>
        <span className="eyebrow">
          <Wand2 className="size-3.5" /> Generate with AI
        </span>
        <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
          Let AI write the listing for you
        </h2>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          Describe the design and Higgstee generates a keyword-rich title, a description, and a
          full set of tags — mapped straight into a ready-to-upload product.
        </p>
        <CheckList
          items={[
            "Runs with your own Gemini API key — never proxied",
            "Structured output maps directly to each field",
            "Edit anything before it goes into the queue",
          ]}
        />
        <Link href="/signup" className="btn-primary mt-8 gap-2 px-5 py-2.5">
          Try it free <ArrowRight className="size-4" />
        </Link>
      </div>
      {/* Visual */}
      <div>
        <div className="hero-panel mx-auto max-w-md">
          <div className="rounded-xl border border-ink-700 bg-ink-950 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="feat-icon !h-8 !w-8 !rounded-lg">
                <Wand2 className="size-4" />
              </span>
              AI listing generator
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="label mb-1.5">Title</div>
                <div className="h-2.5 w-11/12 rounded-full bg-ink-700" />
              </div>
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="label mb-1.5">Description</div>
                <div className="space-y-1.5">
                  <div className="h-2 w-full rounded-full bg-ink-700" />
                  <div className="h-2 w-4/5 rounded-full bg-ink-700" />
                </div>
              </div>
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="label mb-2">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {["retro", "sunset", "vintage", "typography", "gift"].map((t) => (
                    <span key={t} className="chip-info !py-0.5 !text-[11px]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { n: "1", t: "Create a product", d: "Generate listings with AI or import a spreadsheet, then add your artwork.", icon: Sparkles },
    { n: "2", t: "Connect the extension", d: "Install the Higgstee extension and sign in with your account.", icon: UploadCloud },
    { n: "3", t: "Select & upload", d: "Pick a platform and Higgstee fills the forms and publishes for you.", icon: Layers },
  ];
  return (
    <section className="soft-band border-y border-ink-700">
      <div className="mx-auto max-w-7xl px-5 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="eyebrow">
            <RefreshCw className="size-3.5" /> How it works
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
            Three steps from design to published
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map(({ n, t, d, icon: Icon }) => (
            <div key={n} className="feat-card text-center sm:text-left">
              <div className="flex items-center justify-between">
                <span className="feat-icon">
                  <Icon className="size-6" />
                </span>
                <span className="text-4xl font-extrabold text-ink-700">{n}</span>
              </div>
              <h3 className="mt-5 font-semibold text-zinc-900 dark:text-zinc-100">{t}</h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────
function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="relative overflow-hidden rounded-3xl bg-grad-accent p-10 text-center sm:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 opacity-40">
          <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/30 blur-2xl" />
          <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-black/10 blur-2xl" />
        </div>
        <div className="relative">
          <h2 className="text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl">
            Ready to automate your uploads?
          </h2>
          <p className="mx-auto mt-3 max-w-xl font-medium text-neutral-950/70">
            Request access and connect the extension in minutes. No credit card to start.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="btn bg-neutral-950 px-6 py-3 text-base text-white hover:brightness-125"
            >
              Get Started Now
            </Link>
            <Link
              href="/download-extension"
              className="btn border border-neutral-950/25 bg-transparent px-6 py-3 text-base text-neutral-950 hover:bg-neutral-950/10"
            >
              Download Extension
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
