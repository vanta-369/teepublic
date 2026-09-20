import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader, Card } from "@/components/dashboard/DashBits";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocalDataPanel } from "@/components/dashboard/LocalDataPanel";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <DashHeader title="Settings" subtitle="Preferences for your workspace." />
      <div className="space-y-6">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Appearance</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Switch between light and dark.</p>
            </div>
            <ThemeToggle />
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Default platform</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            TeePublic is the default upload target. Etsy, Teachers Pay Teachers, and
            Redbubble will appear here once their automation ships.
          </p>
          <span className="chip-ok mt-3">TeePublic</span>
        </Card>

        <LocalDataPanel />

        <Card>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">AI listing generation</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Your Gemini API key is stored in this browser and is sent only to Google, only when
            you press Generate. Configure it in the Generate step when you create a product.
          </p>
          <Link href="/dashboard/create" className="btn-ghost mt-3">Go to Create</Link>
        </Card>
      </div>
    </>
  );
}
