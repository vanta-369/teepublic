"use client";

import Link from "next/link";
import { ArrowRight, Play, Star } from "lucide-react";
import { type Variants } from "framer-motion";
import { AnimatedGroup } from "@/components/ui/animated-group";

// Fincash-style fintech hero: two columns (copy on the left, a floating app
// panel with orbiting stat cards on the right), a soft brand glow behind it,
// underneath. Rebuilt on Higgstee's own design
// tokens (--ink / --accent) + utility classes (.btn-primary / .hero-panel).
// No external images.

const transitionVariants: { item: Variants } = {
  item: {
    hidden: { opacity: 0, filter: "blur(12px)", y: 12 },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: { type: "spring", bounce: 0.3, duration: 1.5 },
    },
  },
};

const staggerAfterIntro: { container: Variants; item: Variants } = {
  container: {
    visible: { transition: { staggerChildren: 0.05, delayChildren: 0.6 } },
  },
  ...transitionVariants,
};

export function HeroLanding() {
  return (
    <section className="relative overflow-hidden">
      {/* Soft accent glows behind the hero (decorative). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 right-[-10%] h-[34rem] w-[34rem] rounded-full bg-accent-500/15 blur-3xl" />
        <div className="absolute -bottom-40 left-[-10%] h-[30rem] w-[30rem] rounded-full bg-violet2-500/10 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pt-14 pb-10 md:pt-20 lg:grid-cols-2 lg:gap-8">
        {/* ── Copy ─────────────────────────────────────────────────────── */}
        <AnimatedGroup variants={staggerAfterIntro} className="text-center lg:text-left">
          <Link
            href="/how-it-works"
            className="group mx-auto flex w-fit items-center gap-3 rounded-full border border-ink-700 bg-ink-900 p-1 pl-4 shadow-card transition-colors duration-300 hover:border-accent-500/50 lg:mx-0"
          >
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Print-on-demand automation
            </span>
            <span className="block h-4 w-px bg-ink-700" />
            <span className="size-6 overflow-hidden rounded-full bg-ink-800 duration-500 group-hover:bg-accent-500/20">
              <span className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
                <span className="flex size-6">
                  <ArrowRight className="m-auto size-3 text-accent-600 dark:text-accent-400" />
                </span>
                <span className="flex size-6">
                  <ArrowRight className="m-auto size-3 text-accent-600 dark:text-accent-400" />
                </span>
              </span>
            </span>
          </Link>

          <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl md:text-6xl">
            Upload your POD designs{" "}
            <span className="text-accent-600 dark:text-accent-400">everywhere</span> —
            automatically.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-lg text-zinc-500 dark:text-zinc-400 lg:mx-0">
            Prepare a product once and let Higgstee auto-upload it to TeePublic, Etsy,
            Teachers Pay Teachers, and Redbubble through a simple browser extension.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Link href="/signup" className="btn-primary px-6 py-3 text-base">
              Get Started Now
            </Link>
            <Link href="/download-extension" className="btn-ghost gap-2 px-6 py-3 text-base">
              <Play className="size-4 fill-current" />
              Download Extension
            </Link>
          </div>

          {/* Trust row */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:items-center lg:justify-start">
            <div className="flex -space-x-2">
              {["from-accent-400 to-accent-600", "from-zinc-500 to-zinc-700", "from-zinc-600 to-zinc-800", "from-zinc-400 to-zinc-600"].map(
                (g, i) => (
                  <span
                    key={i}
                    className={`inline-block h-8 w-8 rounded-full border-2 border-ink-950 bg-gradient-to-br ${g}`}
                  />
                ),
              )}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1 text-warn-500">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </span>
              <span className="ml-2">Loved by print-on-demand sellers</span>
            </div>
          </div>
        </AnimatedGroup>

        {/* ── Logo panel (Connect-With-Us glow style) ──────────────────── */}
        <AnimatedGroup variants={staggerAfterIntro} className="relative">
          <div
            className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-gray-700/50 bg-gradient-to-br from-gray-800/80 to-gray-900/90 p-10 shadow-2xl backdrop-blur-3xl transition-all duration-500 hover:scale-105 sm:p-14 lg:ml-auto"
            style={{
              boxShadow: "0 0 50px rgba(139, 92, 246, 0.6), 0 0 80px rgba(124, 58, 237, 0.4)",
            }}
          >
            <div className="flex min-h-[16rem] items-center justify-center">
              {/* TeePublic logo — replace this wordmark with the real logo/SVG. */}
              <span className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
                Tee<span className="text-accent-400">Public</span>
              </span>
            </div>
          </div>
        </AnimatedGroup>
      </div>

    </section>
  );
}

