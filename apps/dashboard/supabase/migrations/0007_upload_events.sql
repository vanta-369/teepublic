-- 0007_upload_events.sql
-- Server-side record of every successful publish, so the dashboard can report
-- upload volume (today / yesterday / last 7 / last 30 days).
--
-- Why this table has to exist: until now the ONLY record of a completed upload
-- lived in the extension's `chrome.storage.local` run history. That is
-- per-browser, is wiped by a reinstall, and the dashboard cannot read it, so
-- there was nothing to count. The extension now writes a row here as each item
-- reaches `succeeded`.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

-- ===========================================================================
-- 1. Table
-- ===========================================================================
create table if not exists public.upload_events (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  -- The queue item / design id the extension uploaded. Not a FK: an upload can
  -- come from a spreadsheet batch whose rows were never saved as `designs`.
  design_id    text,
  platform     text        not null default 'teepublic',
  -- The published listing URL the content script detected. Also the dedupe key.
  listing_url  text,
  title        text,
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.upload_events is
  'One row per successfully published listing. Powers the dashboard upload-volume stats.';

-- The stats RPC only ever filters by (user_id, published_at).
create index if not exists upload_events_user_published_idx
  on public.upload_events (user_id, published_at desc);

-- Dedupe: the automation engine can re-confirm a publish through more than one
-- path (ITEM_STATUS, PUBLISHED_URL_DETECTED, and the tab-URL poll fallback), and
-- the service worker may replay a wake-up. A published listing URL is unique, so
-- it is the natural key; inserts use `on conflict do nothing`.
-- Partial, because rows whose URL wasn't captured must still be insertable.
create unique index if not exists upload_events_user_listing_uidx
  on public.upload_events (user_id, listing_url)
  where listing_url is not null;

-- ===========================================================================
-- 2. Row Level Security — a user sees and writes only their own rows
-- ===========================================================================
alter table public.upload_events enable row level security;

drop policy if exists "upload_events_select_own" on public.upload_events;
create policy "upload_events_select_own"
  on public.upload_events for select
  using ((select auth.uid()) = user_id);

drop policy if exists "upload_events_insert_own" on public.upload_events;
create policy "upload_events_insert_own"
  on public.upload_events for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "upload_events_delete_own" on public.upload_events;
create policy "upload_events_delete_own"
  on public.upload_events for delete
  using ((select auth.uid()) = user_id);

-- Deliberately no UPDATE policy: an upload event is an immutable fact.

-- ===========================================================================
-- 3. get_upload_stats() — the rollup the dashboard renders
-- ===========================================================================
-- SECURITY INVOKER (the default): it runs as the caller, so the RLS policy
-- above is what scopes the counts. There is no way to read another user's
-- uploads through it, and no service-role key is involved.
--
-- p_tz is the caller's IANA timezone. "Today" has to mean the USER's today —
-- counting by UTC would roll the day over mid-afternoon for users in the
-- Americas. Callers pass Intl.DateTimeFormat().resolvedOptions().timeZone; an
-- unknown zone falls back to UTC rather than erroring.
create or replace function public.get_upload_stats(p_tz text default 'UTC')
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  uid   uuid := auth.uid();
  tz    text := coalesce(nullif(p_tz, ''), 'UTC');
  today date;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Reject an unrecognised timezone name instead of letting it abort the call.
  begin
    today := (now() at time zone tz)::date;
  exception when others then
    tz := 'UTC';
    today := (now() at time zone tz)::date;
  end;

  return (
    select jsonb_build_object(
      'today',     count(*) filter (where d =  today),
      'yesterday', count(*) filter (where d =  today - 1),
      -- A 7-day window ENDING today (today + the previous 6), and the 7 days
      -- immediately before it, so the UI can show a like-for-like delta.
      'last7',     count(*) filter (where d >  today - 7  and d <= today),
      'prev7',     count(*) filter (where d >  today - 14 and d <= today - 7),
      'last30',    count(*) filter (where d >  today - 30 and d <= today),
      'prev30',    count(*) filter (where d >  today - 60 and d <= today - 30),
      'total',     count(*)
    )
    from (
      select (published_at at time zone tz)::date as d
      from public.upload_events
      where user_id = uid
    ) s
  );
end; $$;

grant execute on function public.get_upload_stats(text) to authenticated;
