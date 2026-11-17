// Gemini (gemini.google.com) jobs, run by the extension in the user's OWN
// browser, on Google accounts the user signed into themselves. Nothing here is
// a credential: an account is the /u/<index>/ slot Google assigns plus the
// address Gemini shows for it. No password, cookie or token is ever read or
// stored.
//
// Shared by the dashboard (sends jobs, renders results) and the extension
// (runs them). Pure types + small pure helpers, like the rest of this package.

/** One signed-in Google account, as the browser numbers it (gemini.google.com/u/<index>/app). */
export interface GeminiAccount {
  index: number;
  email: string;
  /** User-chosen name for the account. Defaults to the email. */
  label: string;
}

export type GeminiJobType = "image" | "listing";

/** Every way a Gemini job can fail. One list, shared by both sides. */
export type GeminiErrorCode =
  | "NOT_SIGNED_IN"
  | "TEMP_CHAT_UNAVAILABLE"
  | "LIMIT_REACHED"
  | "TIMEOUT"
  | "SELECTOR_NOT_FOUND"
  | "UNKNOWN";

export const GEMINI_ERROR_CODES: readonly GeminiErrorCode[] = [
  "NOT_SIGNED_IN",
  "TEMP_CHAT_UNAVAILABLE",
  "LIMIT_REACHED",
  "TIMEOUT",
  "SELECTOR_NOT_FOUND",
  "UNKNOWN",
];

export function isGeminiErrorCode(value: unknown): value is GeminiErrorCode {
  return typeof value === "string" && (GEMINI_ERROR_CODES as readonly string[]).includes(value);
}

export type GeminiJobStatus = "queued" | "running" | "succeeded" | "failed";

/** What a "listing" job returns. */
export interface GeminiListing {
  title: string;
  tags: string[];
  description: string;
}

/** A job as stored and as reported back. Metadata only: the input image and
 *  the generated image live in the extension's IndexedDB, and the generated
 *  image is fetched on its own (GEMINI_RESULT) so the state poll stays small. */
export interface GeminiJob {
  id: string;
  accountIndex: number;
  type: GeminiJobType;
  prompt: string;
  hasInputImage: boolean;
  status: GeminiJobStatus;
  /** While running: what the Gemini tab is doing ("attaching image", ...). */
  step?: string;
  errorCode?: GeminiErrorCode;
  error?: string;
  /** Set on a succeeded "listing" job. */
  listing?: GeminiListing;
  /** Set on a succeeded "image" job: fetch the bytes with GEMINI_RESULT. */
  hasResultImage?: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
}

/** `data` of a successful GEMINI_STATE response. */
export interface GeminiStateData {
  accounts: GeminiAccount[];
  jobs: GeminiJob[];
}

/** How long one job may take, start to finish, before it is a TIMEOUT. */
export const GEMINI_JOB_TIMEOUT_MS = 3 * 60 * 1000;

/** Appended to a "listing" prompt so the answer is machine-readable. */
export const GEMINI_LISTING_INSTRUCTION =
  'Reply with ONLY a JSON object, no other text, in exactly this shape: ' +
  '{"title": string, "tags": string[], "description": string}.';

/**
 * Read the listing out of a Gemini answer. Gemini often wraps JSON in a
 * ```json fence or adds a sentence around it, so this takes the first balanced
 * {...} block that parses and has the right shape. Returns null when there is
 * none: an answer that is not the JSON asked for is never guessed at.
 */
export function parseGeminiListing(text: string): GeminiListing | null {
  if (!text) return null;
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        const listing = toListing(text.slice(start, i + 1));
        if (listing) return listing;
        break;
      }
    }
  }
  return null;
}

function toListing(json: string): GeminiListing | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || typeof v.description !== "string" || !Array.isArray(v.tags)) return null;
  const tags = v.tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
  const title = v.title.trim();
  if (!title) return null;
  return { title, tags, description: v.description.trim() };
}
