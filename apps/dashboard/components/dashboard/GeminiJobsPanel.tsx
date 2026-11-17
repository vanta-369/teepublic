"use client";

// Mirrors the extension's Gemini jobs, the way UploadQueuePanel mirrors the
// upload queue: every read is a live GEMINI_STATE round-trip (metadata only),
// and each job's images are fetched on their own, only for the cards on screen.
//
// "Save as product" puts a finished job into THIS device's design library
// (IndexedDB, lib/designsStore.ts), where Create Product and Uploads pick it up
// like any other design. Nothing is written to a Higgstee server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { GeminiAccount, GeminiJob, GeminiJobStatus } from "@teepublic/shared";
import { EmptyState } from "@/components/dashboard/DashBits";
import { GEMINI_JOBS_CHANGED_EVENT } from "@/components/dashboard/GeminiGeneratePanel";
import {
  fetchGeminiJobImages,
  fetchGeminiState,
  getExtensionId,
  isExtensionAvailable,
  removeGeminiJob,
  retryGeminiJob,
  runGeminiJob,
} from "@/lib/bridge";
import { putDesign, saveDesignImage } from "@/lib/designsStore";
import { dataUrlToBlob } from "@/lib/localDb";
import { allEnabledProducts, applyPreset } from "@/lib/colorPresets";

const POLL_MS = 2500;
const PAGE_SIZE = 12;

const LISTING_FROM_IMAGE_PROMPT =
  "Write a TeePublic listing for the attached design: a specific, marketable title (30-70 characters), " +
  "8 lowercase tags of 1-3 words each, and a 2-3 sentence customer-facing description.";

interface JobImages {
  imageDataUrl: string | null;
  inputImageDataUrl: string | null;
}

function statusChip(status: GeminiJobStatus): string {
  switch (status) {
    case "succeeded": return "chip-ok";
    case "failed":    return "chip-err";
    case "running":   return "chip-info";
    default:          return "chip-mute";
  }
}

function accountName(accounts: GeminiAccount[], index: number): string {
  const a = accounts.find((x) => x.index === index);
  return a ? a.label : `/u/${index}`;
}

export function GeminiJobsPanel({ compact = false }: { compact?: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<GeminiJob[]>([]);
  const [accounts, setAccounts] = useState<GeminiAccount[]>([]);
  const [images, setImages] = useState<Record<string, JobImages>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isExtensionAvailable() || !getExtensionId()) {
      setConnected(false);
      return;
    }
    try {
      const s = await fetchGeminiState();
      setJobs([...s.jobs].sort((a, b) => b.createdAt - a.createdAt));
      setAccounts(s.accounts);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void refresh();
    }, POLL_MS);
    const onChanged = () => { void refresh(); };
    window.addEventListener(GEMINI_JOBS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(GEMINI_JOBS_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = jobs.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  // Images for the cards on screen, fetched once per job once it has any.
  const wanted = useMemo(
    () =>
      shown
        .filter((j) => (j.hasResultImage || j.hasInputImage) && j.status !== "running" && !images[`${j.id}:${j.status}`])
        .map((j) => `${j.id}:${j.status}`)
        .join(","),
    [shown, images],
  );
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    (async () => {
      for (const key of wanted.split(",")) {
        const jobId = key.split(":")[0];
        const imgs = await fetchGeminiJobImages(jobId).catch(() => null);
        if (cancelled) return;
        if (imgs) setImages((prev) => ({ ...prev, [key]: imgs }));
      }
    })();
    return () => { cancelled = true; };
  }, [wanted]);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    busyRef.current = true;
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  async function saveAsProduct(job: GeminiJob, imgs: JobImages | undefined) {
    const art = job.type === "image" ? imgs?.imageDataUrl : imgs?.inputImageDataUrl;
    if (!art) throw new Error("This job has no artwork to save. Attach a design to listing jobs.");
    const blob = dataUrlToBlob(art);
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const id = nanoid(10);
    const filename = `gemini-${job.id}.${ext}`;
    await saveDesignImage(id, blob);
    await putDesign({
      id,
      sessionId: "gemini",
      serverFilename: filename,
      originalName: filename,
      mime: blob.type || "image/png",
      size: blob.size,
      listing: job.listing
        ? {
            title: job.listing.title,
            description: job.listing.description,
            primaryTag: job.listing.tags[0] ?? "",
            tags: job.listing.tags.slice(1),
            matureContent: false,
          }
        : null,
      // Same default as a design dropped into Create Product.
      config: { preset: "light", productColors: applyPreset("light"), enabledProducts: allEnabledProducts() },
      status: job.listing ? "ready" : "idle",
      updatedAt: Date.now(),
    });
  }

  async function writeListingFor(job: GeminiJob, imgs: JobImages | undefined) {
    const art = imgs?.imageDataUrl;
    if (!art) throw new Error("The generated image is not available.");
    const [head, imageBase64] = art.split(",", 2);
    await runGeminiJob({
      jobId: nanoid(12),
      accountIndex: job.accountIndex,
      jobType: "listing",
      prompt: LISTING_FROM_IMAGE_PROMPT,
      imageBase64,
      imageMime: /data:([^;]+)/.exec(head)?.[1] ?? "image/png",
    });
  }

  function copyListing(job: GeminiJob) {
    if (!job.listing) return;
    const text = `${job.listing.title}\n\n${job.listing.description}\n\n${job.listing.tags.join(", ")}`;
    void navigator.clipboard.writeText(text).then(() => setNotice("Listing copied."), () => setError("Could not copy."));
  }

  if (connected === false) {
    if (compact) return null; // the Uploads page already explains the connection
    const stale = !!error && /unknown message type/i.test(error);
    return (
      <EmptyState
        title={stale ? "Extension needs updating" : "Extension not connected"}
        subtitle={stale ? "Update the extension to run Gemini jobs, then reload this page." : "Connect the Higgstee extension to see Gemini jobs."}
        actionLabel={stale ? "Update extension" : "Connect extension"}
        actionHref={stale ? "/download-extension" : "/dashboard/extension"}
      />
    );
  }
  if (connected === null) return <div className="text-sm text-zinc-500">Loading Gemini jobs…</div>;
  if (jobs.length === 0) {
    if (compact) return null;
    return <EmptyState title="No Gemini jobs yet" subtitle="Queue one above — results show up here." />;
  }

  const counts = {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running").length,
    done: jobs.filter((j) => j.status === "succeeded").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Gemini jobs</h2>
        <p className="text-xs text-zinc-500">
          {counts.queued} queued • {counts.running} running • {counts.done} done • {counts.failed} failed
        </p>
      </div>

      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}
      {notice && <div className="chip-ok w-full justify-center py-2">{notice}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((job) => {
          const imgs = images[`${job.id}:${job.status}`];
          const preview = imgs?.imageDataUrl ?? imgs?.inputImageDataUrl ?? null;
          return (
            <div key={job.id} className="surface p-3 flex flex-col">
              <div className="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="h-full w-full grid place-items-center text-2xl text-zinc-600">
                    {job.type === "listing" ? "✎" : "🖼"}
                  </div>
                )}
                <span className="chip-mute absolute top-2 left-2">{job.type}</span>
                <span className={`${statusChip(job.status)} absolute bottom-2 right-2`}>
                  {job.status === "running" ? job.step ?? "running" : job.status}
                </span>
              </div>

              <p className="mt-2 text-xs text-zinc-500 truncate">on {accountName(accounts, job.accountIndex)}</p>

              {job.listing ? (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{job.listing.title}</p>
                  <p className="text-xs text-zinc-500 line-clamp-3">{job.listing.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {job.listing.tags.map((t) => <span key={t} className="chip-mute text-[10px]">{t}</span>)}
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2">{job.prompt}</p>
              )}

              {job.status === "failed" && (
                <p className="mt-2 text-[11px] text-danger-600 dark:text-danger-500 line-clamp-3">
                  <span className="font-mono">{job.errorCode}</span> {job.error}
                </p>
              )}

              <div className="mt-auto pt-3 flex flex-wrap gap-2">
                {job.status === "succeeded" && (
                  <button
                    className="btn-ghost text-xs px-2.5 py-1"
                    disabled={busy || !imgs}
                    onClick={() => run(() => saveAsProduct(job, imgs), "Saved to your products — find it in Create Product.")}
                  >
                    Save as product
                  </button>
                )}
                {job.status === "succeeded" && job.type === "image" && (
                  <button
                    className="btn-ghost text-xs px-2.5 py-1"
                    disabled={busy || !imgs?.imageDataUrl}
                    onClick={() => run(() => writeListingFor(job, imgs), "Listing job queued.")}
                  >
                    Write listing
                  </button>
                )}
                {job.status === "succeeded" && job.type === "image" && imgs?.imageDataUrl && (
                  <a className="btn-ghost text-xs px-2.5 py-1" href={imgs.imageDataUrl} download={`gemini-${job.id}`}>
                    Download
                  </a>
                )}
                {job.listing && (
                  <button className="btn-ghost text-xs px-2.5 py-1" onClick={() => copyListing(job)}>Copy</button>
                )}
                {job.status === "failed" && (
                  <button className="btn-ghost text-xs px-2.5 py-1" disabled={busy} onClick={() => run(() => retryGeminiJob(job.id))}>
                    Retry
                  </button>
                )}
                <button
                  className="btn-ghost text-xs px-2.5 py-1"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await removeGeminiJob(job.id);
                    setImages((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${job.id}:`))));
                  })}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn-ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹ Prev</button>
          <span className="text-zinc-500">Page {currentPage + 1} / {pageCount}</span>
          <button className="btn-ghost" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

export default GeminiJobsPanel;
