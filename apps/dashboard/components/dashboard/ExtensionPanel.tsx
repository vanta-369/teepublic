"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isExtensionAvailable, pingExtension } from "@/lib/bridge";
import { EXTENSION_STORE_URL } from "@/lib/nav";

export function ExtensionPanel() {
  const [chromePresent, setChromePresent] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    setChromePresent(isExtensionAvailable());
  }, []);

  async function onPing() {
    setOk(await pingExtension());
  }

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <div className="surface p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Connection status</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {ok === true
                ? "Your extension is connected and reachable."
                : chromePresent
                  ? "Chrome detected. Test the connection or install the extension."
                  : "Open this dashboard in desktop Chrome to connect the extension."}
            </p>
          </div>
          <div className="flex gap-2">
            <span className={chromePresent ? "chip-ok" : "chip-err"}>
              {chromePresent ? "Chrome detected" : "Chrome required"}
            </span>
            {ok === true && <span className="chip-ok">Connected</span>}
            {ok === false && <span className="chip-err">Not responding</span>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="btn-primary">
            Add to Chrome
          </a>
          <button className="btn-ghost" onClick={onPing} disabled={!chromePresent}>
            Test connection
          </button>
          <Link href="/download-extension" className="btn-ghost">Full install guide</Link>
        </div>
        {ok === false && (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Install Higgstee from the{" "}
            <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="text-accent-500 hover:underline">
              Chrome Web Store
            </a>
            , make sure it is enabled in chrome://extensions, then test again.
          </p>
        )}
      </div>

      {/* How to connect */}
      <div className="surface p-6">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Connect to your account</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Open the extension&apos;s side panel and sign in with the same email and password
          you use here. It connects to your account automatically — no IDs to copy.
        </p>
      </div>

      {/* Supported browsers */}
      <div className="surface p-6">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Supported browsers</h2>
        <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1.5">
          <li>✓ Desktop Chrome and Chromium browsers (Edge, Brave)</li>
          <li>✗ Mobile is not supported — use desktop Chrome to run uploads</li>
        </ul>
      </div>
    </div>
  );
}
