// Filename handling for images added to the local library.
//
// This is what is left of lib/uploadImage.ts, whose name had stopped being true
// twice over: it once POSTed the file to /api/files (a service-role upload into
// a PUBLIC Supabase Storage bucket), and latterly read it into a base64 data
// URL that was then persisted into a Postgres column. Nothing is uploaded now.
// A dropped file's bytes go straight into this device's IndexedDB as a Blob —
// `saveDesignImage` in lib/designsStore.ts, `saveSheetImage` in
// lib/spreadsheetStore.ts — and the caller keeps metadata plus a revocable
// object URL for the preview.

const MAX_SEGMENT = 200;

/**
 * A filename safe to show in the UI and to send to a marketplace's file input.
 * Kept even though nothing writes it to a path any more: a marketplace sees the
 * name, and an unbounded one from a dropped file is still worth trimming.
 */
export function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, MAX_SEGMENT);
}
