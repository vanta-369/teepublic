-- 0009_upload_stats.sql
-- Replace the per-publish event log with ONE aggregate counter per account.
--
-- WHY. `public.upload_events` (migration 0007) stored a row per successful
-- publish carrying design_id, title, listing_url, platform and published_at.
-- The dashboard only ever rendered counts from it, so the descriptive columns
-- bought nothing and cost a complete server-side record of what each seller
-- makes and where it is listed. This migration reduces that to the single fact
-- the product actually needs: how many listings this account has published.
--
-- The new table holds exactly three columns, and no more may be added without
-- revisiting the Privacy Policy:
--     user_id, total_upload_count, updated_at
--
-- Nothing is deleted here. `upload_events` is left in place and READ to build
-- the backfill; retiring it is 0010 (writes locked) and then a separate,
-- approval-gated cleanup migration.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

-- ===========================================================================
-- 1. Table
-- ===========================================================================
create table if not exists public.upload_stats (
  user_id            uuid        primary key references auth.users (id) on delete cascade,
  -- Lifetime count of confirmed successful publishes. bigint because it only
  -- ever goes up and an integer ceiling is a silly way to break a dashboard.
  total_upload_count bigint      not null default 0,
  updated_at         timestamptz not null default now(),
  constraint upload_stats_count_nonnegative check (total_upload_count >= 0)
);

comment on table public.upload_stats is
  'Aggregate successful-upload count per account. Deliberately holds no design id, title, listing URL, filename, description, tags, product configuration or timestamps beyond the last increment.';
comment on column public.upload_stats.total_upload_count is
  'Lifetime count of confirmed successful publishes. Incremented only by increment_upload_count().';

-- ===========================================================================
-- 2. Row Level Security
-- ===========================================================================
-- SELECT own row, and nothing else. There is deliberately NO insert, update or
-- delete policy for users: a user must not be able to set their own number, and
-- the only writer is the SECURITY DEFINER function below, which derives the row
-- from auth.uid(). A user therefore cannot read or touch anyone else's counter.
alter table public.upload_stats enable row level security;

drop policy if exists "upload_stats_select_own" on public.upload_stats;
create policy "upload_stats_select_own"
  on public.upload_stats for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ===========================================================================
-- 3. increment_upload_count() — the only way the number moves
-- ===========================================================================
-- Takes NO arguments on purpose. The caller cannot name a user, a design, a
-- title or an amount; the row is resolved from auth.uid() and the delta is
-- fixed at 1. SECURITY DEFINER because the table has no user-facing write
-- policy, and `set search_path = public` so the definer's rights can't be
-- redirected through a caller-controlled schema.
--
-- The insert ... on conflict do update is a single atomic statement, so two
-- concurrent calls for the same user both land (Postgres takes a row lock for
-- the update) — no read-modify-write race, no lost increment. Double counting
-- from duplicate confirmations or retries is prevented on the client, by item
-- id, precisely so that no listing detail has to be stored here to dedupe on.
create or replace function public.increment_upload_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  total bigint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.upload_stats as s (user_id, total_upload_count, updated_at)
  values (uid, 1, now())
  on conflict (user_id) do update
    set total_upload_count = s.total_upload_count + 1,
        updated_at         = now()
  returning s.total_upload_count into total;

  return total;
end;
$$;

revoke all on function public.increment_upload_count() from public;
grant execute on function public.increment_upload_count() to authenticated;

-- ===========================================================================
-- 4. get_my_upload_count() — convenience read
-- ===========================================================================
-- The dashboard selects straight from the table (RLS scopes it), but an RPC is
-- handy for the extension and for anything that would rather not know the table
-- name. SECURITY INVOKER: it runs as the caller, so the same RLS applies.
create or replace function public.get_my_upload_count()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select total_upload_count from public.upload_stats where user_id = auth.uid()),
    0
  );
$$;

grant execute on function public.get_my_upload_count() to authenticated;

-- ===========================================================================
-- 5. Backfill from the old event log, if it is still present
-- ===========================================================================
-- One aggregate row per user, counting the events that exist right now. Reads
-- only; upload_events is untouched. Guarded by to_regclass so this migration
-- also applies cleanly to a project that never had 0007.
--
-- `greatest` rather than a plain overwrite: if the extension has already
-- started incrementing the new counter before this runs, the backfill must not
-- walk it backwards.
do $$
declare
  migrated int := 0;
begin
  if to_regclass('public.upload_events') is null then
    raise notice 'upload_events not present - nothing to backfill';
    return;
  end if;

  with totals as (
    select user_id, count(*)::bigint as n
    from public.upload_events
    group by user_id
  )
  insert into public.upload_stats as s (user_id, total_upload_count, updated_at)
  select t.user_id, t.n, now()
  from totals t
  -- Only for users who still exist; a deleted account has nothing to count.
  join auth.users u on u.id = t.user_id
  on conflict (user_id) do update
    set total_upload_count = greatest(s.total_upload_count, excluded.total_upload_count),
        updated_at         = now();

  get diagnostics migrated = row_count;
  raise notice 'upload_stats backfilled for % user(s)', migrated;
end;
$$;

-- ===========================================================================
-- 6. Retire the old stats RPC
-- ===========================================================================
-- get_upload_stats(text) bucketed publishes by day in the caller's timezone.
-- Those buckets require per-event timestamps, which is exactly what is being
-- removed, so the function goes. Dropping a function deletes no user data.
drop function if exists public.get_upload_stats(text);
