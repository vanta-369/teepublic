-- 0011_cleanup_legacy_data.sql
--
--   *** THIS MIGRATION IS INERT. IT DELETES NOTHING AS CHECKED IN. ***
--
-- Every destructive statement below is commented out. Applying this file to a
-- database is a no-op: it raises a notice and stops. That is deliberate — the
-- owner asked to see the findings and approve before any existing image,
-- listing or upload-event record is removed.
--
-- PREREQUISITES, IN ORDER:
--   1. Migration 0009 applied (upload_stats exists and is backfilled).
--   2. Migration 0010 applied (legacy tables and the Storage bucket are
--      read-only, so nothing new is accumulating while you review).
--   3. supabase/INSPECT_LEGACY_DATA.sql run, and its output reviewed. Section D
--      in particular must show delta = 0 for every user, or the counter has not
--      absorbed the events you are about to delete.
--   4. Anything worth keeping exported (Storage download / pg_dump of the four
--      tables). Deletion here is permanent.
--   5. The bucket flipped private (0010, step 6) and left that way long enough
--      to be confident nothing depends on the public URLs.
--   6. Explicit approval from the project owner to proceed.
--
-- HOW TO RUN IT WHEN APPROVED: uncomment exactly the blocks you have approved,
-- one at a time, and run them one at a time, re-running the inspection between
-- steps. Do not uncomment the whole file in one go.

do $$
begin
  raise notice '0011_cleanup_legacy_data.sql applied as a NO-OP. Every destructive statement in this file is commented out pending explicit approval. See the header for the checklist.';
end;
$$;

-- ===========================================================================
-- STEP 1 (approval required) — delete base64 artwork from public.designs
-- ===========================================================================
-- Removes ONLY the image payload, leaving the row and its listing copy behind,
-- so this can be done first and reviewed before step 2. Reclaims the most space
-- for the least loss.
--
-- Expected: designs.data_url_rows from inspection section A drops to 0.
--
--   update public.designs
--      set image_url = ''
--    where image_url like 'data:%';
--
--   vacuum (analyze) public.designs;   -- run separately; cannot be in a txn block

-- ===========================================================================
-- STEP 2 (approval required) — delete the design rows entirely
-- ===========================================================================
-- Removes the listing copy, tags, product configuration and filenames too. The
-- user's own library is already local (IndexedDB) and is NOT affected by this;
-- this only removes the server's stale copy.
--
--   delete from public.designs;
--
--   drop table if exists public.designs;   -- only after a retention period

-- ===========================================================================
-- STEP 3 (approval required) — delete stored spreadsheet batches
-- ===========================================================================
-- One JSONB blob per user holding parsed rows, product configuration and (in
-- older rows) inline base64 images.
--
--   delete from public.spreadsheet_batches;
--
--   drop table if exists public.spreadsheet_batches;

-- ===========================================================================
-- STEP 4 (approval required) — delete stored earnings exports
-- ===========================================================================
-- Raw CSV of a user's TeePublic earnings: design titles, product types, prices.
--
--   delete from public.sales_reports;
--
--   drop table if exists public.sales_reports;

-- ===========================================================================
-- STEP 5 (approval required) — delete per-upload event rows
-- ===========================================================================
-- DO NOT RUN THIS until inspection section D shows delta = 0 for every user.
-- Once these rows are gone the aggregate counter is the only record, and it
-- cannot be rebuilt.
--
--   delete from public.upload_events;
--
--   drop table if exists public.upload_events;

-- ===========================================================================
-- STEP 6 (approval required) — scrub design ids from generation logs
-- ===========================================================================
-- Older `generation.*` rows in activity_logs carry an `imageId` (a local design
-- id) and, on failures, the raw error text. The client no longer sends either.
-- This strips them from history without losing the audit trail of who generated
-- what and when.
--
--   update public.activity_logs
--      set metadata = metadata - 'imageId' - 'message'
--    where action like 'generation.%'
--      and (metadata ? 'imageId' or metadata ? 'message');

-- ===========================================================================
-- STEP 7 (approval required) — empty the `designs` Storage bucket
-- ===========================================================================
-- Storage objects are NOT removed by deleting rows from storage.objects alone
-- in every Supabase configuration — the file on S3 can be orphaned. Prefer the
-- documented paths, in this order of preference:
--
--   a. Supabase Dashboard -> Storage -> designs -> select all -> Delete.
--   b. Supabase CLI / JS admin client:
--        supabase.storage.from('designs').remove([...paths])
--      which removes both the object row and the underlying file.
--   c. Only if (a) and (b) are unavailable, as a last resort:
--
--        delete from storage.objects where bucket_id = 'designs';
--
-- Then, once the bucket is confirmed empty:
--
--   delete from storage.buckets where id = 'designs';

-- ===========================================================================
-- AFTER CLEANUP
-- ===========================================================================
-- Re-run supabase/INSPECT_LEGACY_DATA.sql. Sections A, B, C and D should all
-- report zero rows, and section E zero objects. What remains in the project is
-- then: auth.users, public.profiles (email, approval, plan, trial, status,
-- admin flag), subscriptions/billing_events, activity_logs, user_settings, the
-- roles/permissions tables, and public.upload_stats (user_id,
-- total_upload_count, updated_at) — which is exactly what the Privacy Policy
-- describes.
