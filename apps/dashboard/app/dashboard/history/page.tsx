import type { Metadata } from "next";
import Link from "next/link";
import { DashHeader, Card } from "@/components/dashboard/DashBits";

export const metadata: Metadata = { title: "Upload History" };

export default function HistoryPage() {
  return (
    <>
      <DashHeader title="Upload History" subtitle="A record of what you've published." />
      <Card>
        <div className="flex items-start gap-3 mb-3">
          <span className="chip-info">In the extension</span>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The extension tracks each upload&apos;s result and the published listing URL as it
            works. Open the extension side panel to see the full run history and links to
            your published listings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/products" className="btn-ghost">View products</Link>
          <Link href="/dashboard/extension" className="btn-ghost">Open extension</Link>
        </div>
      </Card>
    </>
  );
}
