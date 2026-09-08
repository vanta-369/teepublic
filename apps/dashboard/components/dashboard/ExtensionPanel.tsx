"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExtensionStatus } from "@/components/ExtensionStatus";
import {
  getExtensionId,
  setExtensionId,
  isExtensionAvailable,
  pingExtension,
} from "@/lib/bridge";
import { EXTENSION_STORE_URL } from "@/lib/nav";

export function ExtensionPanel() {
  const [chromePresent, setChromePresent] = useState(false);
  const [extId, setExtId] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setChromePresent(isExtensionAvailable());
    setExtId(getExtensionId() ?? "");
  }, []);

  function onChange(v: string) {
    setExtId(v);
    setExtensionId(v);
    setOk(null);
  }
  async function onPing() {
    setOk(await pingExtension(extId || undefined));
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

      {/* Advanced / support-only manual pairing */}
      <div className="surface p-6">
        <button
          className="text-sm text-zinc-500 hover:text-accent-500"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide" : "Advanced"}: manual connection (support only)
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-zinc-500">
              Only needed for manually loaded builds. Paste the extension ID from
              chrome://extensions, then test the connection.
            </p>
            <ExtensionStatus
              chromePresent={chromePresent}
              extensionId={extId}
              onChange={onChange}
              onPing={onPing}
              ok={ok}
            />
          </div>
        )}
      </div>
    </div>
  );
}
