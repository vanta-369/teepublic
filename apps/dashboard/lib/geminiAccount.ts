// Listing generation through a Google account connected in the extension - the
// "Google account" alternative to lib/gemini.ts (API key). Same inputs, same
// GeneratedListing out, so GenerationApp treats both sources alike.
//
// Under the hood it is one Gemini job: queued in the extension, polled until
// it finishes, then removed so nothing piles up in the extension's job list.
// The design goes from this page to the local extension to Google - never to a
// Higgstee server.

import { nanoid } from "nanoid";
import type { GeminiErrorCode, GeminiListing } from "@teepublic/shared";
import { fetchGeminiState, removeGeminiJob, runGeminiJob } from "./bridge";
import type { GeneratedListing } from "./gemini";

const POLL_MS = 2000;
// The extension fails a job after 3 minutes plus a grace period; this is only a
// backstop for an extension that stopped answering.
const GIVE_UP_MS = 6 * 60 * 1000;

const FRIENDLY: Record<GeminiErrorCode, string> = {
  NOT_SIGNED_IN: "That Google account is no longer signed in. Reconnect it on the Connect account page.",
  TEMP_CHAT_UNAVAILABLE: "Gemini couldn't start a private chat on that account. Try again or pick another account.",
  LIMIT_REACHED: "That Google account has reached its Gemini limit for now. Try later or pick another account.",
  TIMEOUT: "Gemini took too long to answer. Try again, or shorten the prompt.",
  SELECTOR_NOT_FOUND: "The extension couldn't use Gemini's page.",
  UNKNOWN: "Gemini didn't return a listing. Try again.",
};

export interface AccountGenerateOptions {
  accountIndex: number;
  prompt: string;
  imageBase64: string;
  imageMime: string;
  signal?: AbortSignal;
}

export async function generateListingViaAccount(opts: AccountGenerateOptions): Promise<GeneratedListing> {
  const jobId = nanoid(12);
  await runGeminiJob({
    jobId,
    accountIndex: opts.accountIndex,
    jobType: "listing",
    prompt: [
      "Create a TeePublic listing for the design in the attached image.",
      `Theme / direction from the user: ${opts.prompt.trim() || "(no extra theme - derive from the image)"}`,
      "Give 9 tags, lowercase, 1-3 words each, no '#'.",
    ].join("\n"),
    imageBase64: opts.imageBase64,
    imageMime: opts.imageMime,
  });

  const cleanup = () => removeGeminiJob(jobId).catch(() => undefined);
  const deadline = Date.now() + GIVE_UP_MS;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_MS, opts.signal);
      const job = (await fetchGeminiState()).jobs.find((j) => j.id === jobId);
      if (!job) throw new Error("The generation was cancelled in the extension.");
      if (job.status === "succeeded") {
        if (!job.listing) throw new Error(FRIENDLY.UNKNOWN);
        return toGeneratedListing(job.listing);
      }
      if (job.status === "failed") {
        // Keep the extension's own detail for the two vague codes - it names
        // the step that failed, which is what a fix needs.
        const vague = job.errorCode === "SELECTOR_NOT_FOUND" || job.errorCode === "UNKNOWN";
        const base = job.errorCode ? FRIENDLY[job.errorCode] : FRIENDLY.UNKNOWN;
        throw new Error(vague && job.error ? `${base} ${job.error}` : base);
      }
    }
    throw new Error(FRIENDLY.TIMEOUT);
  } finally {
    // Also closes the Gemini tab if the user cancelled mid-run.
    await cleanup();
  }
}

/** Gemini answers {title, tags, description}; the first tag becomes TeePublic's primary tag. */
function toGeneratedListing(l: GeminiListing): GeneratedListing {
  const [primaryTag = "", ...tags] = l.tags;
  return { title: l.title, description: l.description, primaryTag, tags, matureContent: false };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
