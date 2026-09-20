-- 0010_lock_legacy_writes.sql
-- Close every server-side path that could still accept design artwork or
-- listing content. NOTHING IS DELETED HERE.
--
-- After this migration the legacy tables and the `designs` Storage bucket are
-- READ-ONLY to users: existing rows and files stay exactly as they are, so they
-- can be inspected and exported, but nothing new can be written and nothing
-- existing can be modified. Deleting the contents is a separate, approval-gated
-- migration (0011) that is inert until someone uncomments it.
--
-- The application no longer writes any of this: /api/designs, /api/spreadsheet,
-- /api/sales-report and /api/files were removed, lib/fileStore.ts (the
-- service-role uploader) was removed, and both Supabase clients now run through
-- a fetch guard that throws on image bytes or listing content. This migration
-- is the database-side half of the same guarantee — belt and braces, because an
-- app-layer rule is one refactor away from being untrue.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

-- ===========================================================================
-- 1. public.designs — no more writes
-- ===========================================================================
-- SELECT and DELETE stay: a user must be able to see what is still stored under
-- their account and remove it themselves.
do $$
begin
  if to_regclass('public.designs') is null then
    raise notice 'public.designs not present - skipping';
    return;
  end if;
  execute 'drop policy if exists "designs_insert_own" on public.designs';
  execute 'drop policy if exists "designs_update_own" on public.designs';
  execute $q$comment on table public.designs is
    'RETIRED (migration 0010). Designs, listings and artwork are stored locally in the user''s browser (IndexedDB). This table is read-only; no application path writes to it. Contents pending review before deletion - see 0011_cleanup_legacy_data.sql.'$q$;
end;
$$;

-- ===========================================================================
-- 2. public.spreadsheet_batches — no more writes
-- ===========================================================================
do $$
begin
  if to_regclass('public.spreadsheet_batches') is null then
    raise notice 'public.spreadsheet_batches not present - skipping';
    return;
  end if;
  execute 'drop policy if exists "spreadsheet_insert_own" on public.spreadsheet_batches';
  execute 'drop policy if exists "spreadsheet_update_own" on public.spreadsheet_batches';
  execute $q$comment on table public.spreadsheet_batches is
    'RETIRED (migration 0010). The From-spreadsheet batch is stored locally in the user''s browser (IndexedDB). Read-only; contents pending review before deletion.'$q$;
end;
$$;

-- ===========================================================================
-- 3. public.sales_reports — no more writes
-- ===========================================================================
-- An earnings export is listing content: every row carries a design title, a
-- product type and a price. It belongs on the user's device.
do $$
begin
  if to_regclass('public.sales_reports') is null then
    raise notice 'public.sales_reports not present - skipping';
    return;
  end if;
  execute 'drop policy if exists "sales_reports_insert_own" on public.sales_reports';
  execute 'drop policy if exists "sales_reports_update_own" on public.sales_reports';
  execute $q$comment on table public.sales_reports is
    'RETIRED (migration 0010). The earnings export is stored locally in the user''s browser (IndexedDB). Read-only; contents pending review before deletion.'$q$;
end;
$$;

-- ===========================================================================
-- 4. public.upload_events — no more writes
-- ===========================================================================
-- Superseded by public.upload_stats (migration 0009), which already holds the
-- backfilled totals. The extension no longer inserts here.
do $$
begin
  if to_regclass('public.upload_events') is null then
    raise notice 'public.upload_events not present - skipping';
    return;
  end if;
  execute 'drop policy if exists "upload_events_insert_own" on public.upload_events';
  execute $q$comment on table public.upload_events is
    'RETIRED (migration 0010). Superseded by public.upload_stats, which holds only an aggregate count. Read-only; contents pending review before deletion.'$q$;
end;
$$;

-- ===========================================================================
-- 5. The `designs` Storage bucket — no more uploads
-- ===========================================================================
-- Migration 0004 let ANY authenticated user insert and update objects in this
-- bucket, from the browser, with no path scoping — so one user could overwrite
-- another's file if they knew the path. Both policies go. Reads are unaffected
-- by this statement (the bucket's own `public` flag governs those), so existing
-- files remain fetchable until the bucket is flipped private in step 6.
drop policy if exists "designs_objects_insert_authenticated" on storage.objects;
drop policy if exists "designs_objects_update_authenticated" on storage.objects;

-- ===========================================================================
-- 6. PLAN: making the public bucket inaccessible
-- ===========================================================================
-- DELIBERATELY NOT EXECUTED. Flipping the bucket private is reversible and
-- deletes nothing, but it immediately breaks every public object URL — and any
-- row in `public.designs` written before this release still points at one. Run
-- it only after the inspection in supabase/INSPECT_LEGACY_DATA.sql confirms
-- what is in there and the owner has decided what to keep.
--
-- Recommended order:
--   1. Run INSPECT_LEGACY_DATA.sql and review the counts and samples.
--   2. Export anything worth keeping (Storage -> designs -> download, or the
--      Supabase CLI), so nothing is lost by making it unreachable.
--   3. Flip the bucket private (statement below). Public URLs stop resolving;
--      objects are still there and still downloadable by the project owner via
--      the dashboard, the service role, or a signed URL.
--   4. Leave it private for a cooling-off period; nothing in the app reads it.
--   5. Only then run 0011_cleanup_legacy_data.sql to delete the objects.
--
-- To perform step 3, uncomment exactly this line and run it:
--
--   update storage.buckets set public = false where id = 'designs';
--
-- To reverse it:
--
--   update storage.buckets set public = true  where id = 'designs';
