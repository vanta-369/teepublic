-- 0008_sales_reports.sql
-- Keeps the user's most recent TeePublic earnings export attached to their
-- account, so the Sales & Earnings page is populated on load instead of asking
-- for the file again on every visit. Uploading a new export replaces the old one.
--
-- Design notes:
--   * ONE row per user (user_id is the primary key). This is "the current
--     report", not a history — the upsert in the API route overwrites in place,
--     so there's nothing to prune later.
--   * We store the RAW file text, not parsed rows. Re-parsing on load keeps a
--     single source of truth (lib/csv-parser.ts): a parser fix applies to the
--     already-uploaded file instead of leaving stale rows shaped by the old
--     code. It's also far smaller than the JSON expansion of the same data.
--   * Excel uploads are converted to CSV text before being stored, so `content`
--     is always CSV regardless of what was dropped.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

create table if not exists public.sales_reports (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  filename    text        not null,
  -- Raw CSV text of the export.
  content     text        not null,
  -- Denormalised for the "uploaded X, N rows" line in the UI, so the page can
  -- describe the stored report without parsing it first.
  row_count   integer     not null default 0,
  uploaded_at timestamptz not null default now()
);

comment on table public.sales_reports is
  'The user''s current TeePublic earnings export (raw CSV). One row per user; a new upload replaces it.';

-- ===========================================================================
-- Row Level Security — a user reads and writes only their own report
-- ===========================================================================
alter table public.sales_reports enable row level security;

drop policy if exists "sales_reports_select_own" on public.sales_reports;
create policy "sales_reports_select_own"
  on public.sales_reports for select
  using ((select auth.uid()) = user_id);

drop policy if exists "sales_reports_insert_own" on public.sales_reports;
create policy "sales_reports_insert_own"
  on public.sales_reports for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "sales_reports_update_own" on public.sales_reports;
create policy "sales_reports_update_own"
  on public.sales_reports for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "sales_reports_delete_own" on public.sales_reports;
create policy "sales_reports_delete_own"
  on public.sales_reports for delete
  using ((select auth.uid()) = user_id);
