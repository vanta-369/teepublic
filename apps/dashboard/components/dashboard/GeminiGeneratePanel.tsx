"use client";

// Queue Gemini jobs in the extension: a prompt, an optional design, and the
// account to run on. Several images make several jobs (one per image), all on
// the account picked here. Nothing is sent anywhere but the local extension,
// which types it into gemini.google.com in that account's background tab.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import type { GeminiAccount, GeminiJobType } from "@teepublic/shared";
import { fileToBase64 } from "@/lib/gemini";
import { getExtensionId, isExtensionAvailable, listGeminiAccounts, runGeminiJob } from "@/lib/bridge";

/** Fired after jobs are queued so the jobs panel re-reads immediately. */
export const GEMINI_JOBS_CHANGED_EVENT = "higgstee:gemini-jobs-changed";

const DEFAULT_PROMPTS: Record<GeminiJobType, string> = {
  listing:
    "Write a TeePublic listing for the attached design: a specific, marketable title (30-70 characters), " +
    "8 lowercase tags of 1-3 words each, and a 2-3 sentence customer-facing description.",
  image: "",
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function GeminiGeneratePanel() {
  const [accounts, setAccounts] = useState<GeminiAccount[] | null>(null);
  const [accountIndex, setAccountIndex] = useState<number | null>(null);
  const [jobType, setJobType] = useState<GeminiJobType>("listing");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPTS.listing);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isExtensionAvailable() || !getExtensionId()) {
      setAccounts([]);
      return;
    }
    listGeminiAccounts(false)
      .then((list) => {
        setAccounts(list);
        setAccountIndex((cur) => cur ?? list[0]?.index ?? null);
      })
      .catch((e) => {
        setAccounts([]);
        setError((e as Error).message);
      });
  }, []);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  function pickType(next: GeminiJobType) {
    // Swap in the other default only if the prompt is still the untouched one.
    if (prompt === DEFAULT_PROMPTS[jobType]) setPrompt(DEFAULT_PROMPTS[next]);
    setJobType(next);
  }

  function addFiles(list: FileList | null) {
    const picked = [...(list ?? [])].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    const tooBig = picked.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) setError(`${tooBig.name} is over 20 MB.`);
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_IMAGE_BYTES)]);
  }

  async function addToQueue() {
    if (accountIndex == null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const inputs: (File | null)[] = files.length ? files : [null];
      for (const file of inputs) {
        await runGeminiJob({
          jobId: nanoid(12),
          accountIndex,
          jobType,
          prompt: prompt.trim(),
          imageBase64: file ? await fileToBase64(file) : undefined,
          imageMime: file?.type,
        });
      }
      setNotice(`${inputs.length} job${inputs.length === 1 ? "" : "s"} added to the queue.`);
      setFiles([]);
      window.dispatchEvent(new Event(GEMINI_JOBS_CHANGED_EVENT));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needsImage = jobType === "listing" && files.length === 0;
  const canQueue = !busy && accountIndex != null && prompt.trim().length > 0;

  return (
    <div className="surface p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">New Gemini job</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Runs in a background tab on gemini.google.com, in a Temporary chat, on the account you pick.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["listing", "image"] as GeminiJobType[]).map((t) => (
            <button
              key={t}
              onClick={() => pickType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                jobType === t
                  ? "bg-accent-500/15 text-accent-600 dark:text-accent-400 border-accent-500/40"
                  : "bg-ink-800 text-zinc-500 border-ink-700 hover:text-zinc-300"
              }`}
            >
              {t === "listing" ? "Listing" : "Image"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Account</span>
        {accounts === null ? (
          <p className="mt-1.5 text-sm text-zinc-500">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="mt-1.5 text-sm text-zinc-500">
            No Google accounts found.{" "}
            <Link href="/dashboard/gemini/accounts" className="text-accent-500 hover:underline">
              Set up accounts
            </Link>
          </p>
        ) : (
          <select
            className="input mt-1.5 w-full sm:w-80"
            value={accountIndex ?? ""}
            onChange={(e) => setAccountIndex(Number(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.index} value={a.index}>
                {a.label === a.email ? a.email : `${a.label} (${a.email})`}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <span className="label">Prompt</span>
        <textarea
          className="input mt-1.5 w-full min-h-[110px]"
          value={prompt}
          placeholder={jobType === "image" ? "Describe the image to create…" : ""}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {jobType === "listing" && (
          <p className="mt-1 text-xs text-zinc-500">
            The extension adds an instruction to answer as JSON (title, tags, description).
          </p>
        )}
      </div>

      <div>
        <span className="label">Image (optional{files.length > 1 ? " — one job per image" : ""})</span>
        <div className="mt-1.5 flex flex-wrap gap-3 items-center">
          {previews.map((src, i) => (
            <div key={src} className="relative h-20 w-20 rounded-lg overflow-hidden border border-ink-700 bg-ink-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-contain" />
              <button
                className="absolute top-0.5 right-0.5 h-5 w-5 rounded bg-black/60 text-white text-xs"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => fileInput.current?.click()}>
            {files.length ? "Add more" : "Choose image"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
        {needsImage && (
          <p className="mt-1.5 text-xs text-warn-600 dark:text-warn-500">
            A listing job usually needs the design attached.
          </p>
        )}
      </div>

      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}
      {notice && <div className="chip-ok w-full justify-center py-2">{notice}</div>}

      <div className="flex justify-end">
        <button className="btn-primary" disabled={!canQueue} onClick={() => void addToQueue()}>
          {busy ? "Adding…" : files.length > 1 ? `Add ${files.length} jobs to queue` : "Add to queue"}
        </button>
      </div>
    </div>
  );
}

export default GeminiGeneratePanel;
