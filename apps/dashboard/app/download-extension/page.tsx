import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";
import { EXTENSION_STORE_URL } from "@/lib/nav";

export const metadata: Metadata = { title: "Download Extension" };

const INSTALL_STEPS = [
  "Click “Add to Chrome” to open the Higgstee listing in the Chrome Web Store.",
  "Press “Add to Chrome”, then confirm “Add extension”.",
  "Pin Higgstee to your toolbar and open its side panel.",
];

const TROUBLESHOOTING = [
  { q: "Extension shows “not connected”", a: "Open the side panel and sign in with your Higgstee email and password. Make sure you're signed in to the same account as your dashboard." },
  { q: "Wrong account", a: "Sign out in the side panel and sign back in with the correct account." },
  { q: "“Access denied” or pending approval", a: "Your account may still be awaiting admin approval or your trial may have ended. Check your Subscription page in the dashboard." },
  { q: "Still stuck?", a: "Reinstall the extension, or contact support and we'll help — including a manual install if your setup requires it." },
];

export default function DownloadExtensionPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Browser extension"
        title="Install the Higgstee extension"
        subtitle="The extension does the uploading — it fills in and publishes your listings on each platform."
      />

      <section className="mx-auto max-w-3xl px-5 py-6 text-center">
        <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="btn-primary px-6 py-3 text-base">
          Add to Chrome
        </a>
        <p className="mt-3 text-xs text-zinc-500">Free · desktop Chrome &amp; Chromium browsers</p>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-6 space-y-6">
        <Card title="Installation steps">
          <ol className="space-y-3">
            {INSTALL_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="h-6 w-6 shrink-0 rounded bg-accent-500/15 text-accent-600 dark:text-accent-400 grid place-items-center text-xs font-bold">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Connect it to your Higgstee account">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Open the extension&apos;s side panel and sign in with the <strong>same email and
            password</strong> you use for the dashboard. Because the extension has a fixed
            identity, it connects to your account automatically — no IDs to copy.
          </p>
        </Card>

        <Card title="Connection status">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Once signed in, the side panel shows <span className="chip-ok">Connected</span>. You
            can confirm it any time from{" "}
            <Link href="/dashboard/extension" className="text-accent-500 hover:text-accent-400">
              Dashboard → Extension
            </Link>{" "}
            using “Test connection”.
          </p>
        </Card>

        <Card title="Supported browsers & devices">
          <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1.5">
            <li>✓ Desktop Chrome and Chromium-based browsers (Edge, Brave)</li>
            <li>✗ Mobile browsers are not supported — the extension needs a desktop browser</li>
          </ul>
        </Card>

        <Card title="Desktop vs mobile">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Uploads require desktop Chrome. You can browse the site and your dashboard on
            mobile, but to install the extension and run uploads, switch to a desktop
            Chrome browser.
          </p>
        </Card>

        <Card title="Troubleshooting">
          <div className="space-y-3">
            {TROUBLESHOOTING.map((t) => (
              <details key={t.q} className="surface-soft p-4 group">
                <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {t.q}
                  <span className="text-zinc-400 group-open:rotate-45 transition">+</span>
                </summary>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t.a}</p>
              </details>
            ))}
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-3xl px-5 pb-16 text-center">
        <p className="text-sm text-zinc-500">
          Don&apos;t have an account yet?{" "}
          <Link href="/signup" className="text-accent-500 hover:text-accent-400">Request access</Link>.
        </p>
      </section>
    </SiteShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface p-6">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">{title}</h2>
      {children}
    </div>
  );
}
