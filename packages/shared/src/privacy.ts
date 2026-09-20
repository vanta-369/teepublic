// Privacy guards — the single definition of "image bytes" and "listing
// content" used by the dashboard, the extension and the test suite.
//
// WHY THIS EXISTS AS RUNTIME CODE, not just a rule in a doc: the product
// promise is that artwork and listing copy never reach Higgstee's Supabase
// project. A rule that is only written down gets broken by the next refactor.
// These predicates are wired into the Supabase fetch path on both clients
// (see lib/supabase/guardedFetch.ts), so a request that WOULD carry artwork or
// listing copy throws before it leaves the machine, and the same predicates are
// what the tests assert against.
//
// They are deliberately conservative: a false positive is a loud local error
// during development, a false negative is a privacy regression in production.

/** Marker on an error thrown by the guards, so callers can recognise it. */
export const PRIVACY_VIOLATION = "HiggsteePrivacyViolation";

export class PrivacyViolationError extends Error {
  constructor(public readonly detail: string) {
    super(`${PRIVACY_VIOLATION}: ${detail}`);
    this.name = PRIVACY_VIOLATION;
  }
}

/**
 * Object keys that carry listing content — the copy, artwork references and
 * product configuration a user composes locally. None of these may appear in a
 * request to Higgstee's own backend or to Supabase.
 */
export const LISTING_CONTENT_KEYS: readonly string[] = [
  "title",
  "description",
  "tags",
  "primaryTag",
  "primary_tag",
  "listing",
  "metadata",
  "productColors",
  "product_colors",
  "enabledProducts",
  "enabled_products",
  "filename",
  "originalName",
  "original_name",
  "serverFilename",
  "server_filename",
  "imageUrl",
  "image_url",
  "imageBase64",
  "listingUrl",
  "listing_url",
  "designId",
  "design_id",
  "rows",
  "items",
  "batch",
  "designs",
  "price",
  "matureContent",
  "mature_content",
];

/**
 * A base64 run long enough to be a picture. A 4 KiB threshold is ~3 KB of
 * binary — far larger than any id, hash or signature the app sends, and far
 * smaller than the smallest real design PNG. JWTs are excluded by the dot test
 * in `looksLikeRawBase64`, since Supabase auth bodies legitimately carry them.
 */
const RAW_BASE64_MIN_LENGTH = 4096;

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(;[^,]*)?,/i;
const BASE64_ONLY_RE = /^[A-Za-z0-9+/=\s]+$/;

/** True for any `data:` URL — the form a browser-read image file takes. */
export function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && DATA_URL_RE.test(value.trim());
}

/** True for a bare base64 payload big enough to be image bytes. */
export function looksLikeRawBase64(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < RAW_BASE64_MIN_LENGTH) return false;
  // JWTs (header.payload.signature) are base64url with dots and are a normal,
  // required part of Supabase auth traffic.
  if (value.includes(".")) return false;
  return BASE64_ONLY_RE.test(value);
}

/** True for a blob: / filesystem: URL, which also references local bytes. */
export function isLocalObjectUrl(value: unknown): value is string {
  return typeof value === "string" && /^(blob|filesystem):/i.test(value.trim());
}

function walk(
  value: unknown,
  path: string,
  visit: (v: unknown, path: string, key: string | null) => string | null,
  seen: Set<object>,
  key: string | null = null,
): string | null {
  const hit = visit(value, path, key);
  if (hit) return hit;

  if (value && typeof value === "object") {
    if (seen.has(value as object)) return null;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = walk(value[i], `${path}[${i}]`, visit, seen, key);
        if (found) return found;
      }
      return null;
    }

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const found = walk(v, path ? `${path}.${k}` : k, visit, seen, k);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Describe the first image-byte payload found anywhere in `value`, or null.
 * Handles nested objects/arrays and JSON strings that themselves parse to one.
 */
export function findImageBytes(value: unknown): string | null {
  return walk(
    value,
    "",
    (v, path) => {
      if (isDataUrl(v)) return `${path || "<root>"} is a data: URL (${v.slice(0, 32)}…)`;
      if (isLocalObjectUrl(v)) return `${path || "<root>"} is a local object URL`;
      if (looksLikeRawBase64(v)) {
        return `${path || "<root>"} is a ${v.length}-char base64 payload`;
      }
      return null;
    },
    new Set(),
  );
}

/** Describe the first listing-content field found anywhere in `value`, or null. */
export function findListingContent(value: unknown): string | null {
  return walk(
    value,
    "",
    (v, path, key) => {
      if (key && LISTING_CONTENT_KEYS.includes(key)) {
        // An explicitly empty/absent field is not content.
        if (v === null || v === undefined || v === "") return null;
        if (Array.isArray(v) && v.length === 0) return null;
        return `${path || key} is listing content`;
      }
      return null;
    },
    new Set(),
  );
}

/** Throw if `value` carries image bytes. */
export function assertNoImageBytes(label: string, value: unknown): void {
  const hit = findImageBytes(value);
  if (hit) throw new PrivacyViolationError(`${label}: ${hit}`);
}

/** Throw if `value` carries listing content. */
export function assertNoListingContent(label: string, value: unknown): void {
  const hit = findListingContent(value);
  if (hit) throw new PrivacyViolationError(`${label}: ${hit}`);
}

/**
 * Parse a fetch body into something the guards can walk. Returns `undefined`
 * when the body is a stream/binary form we cannot inspect — callers decide
 * whether that is acceptable for the endpoint in question.
 */
export function bodyForInspection(body: unknown): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") {
    const text = body.trim();
    if (!text) return undefined;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  return undefined;
}
