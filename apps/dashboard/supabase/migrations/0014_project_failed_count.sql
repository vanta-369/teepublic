-- 0014_project_failed_count.sql
-- Projects also count designs whose upload FAILED, next to the published count.
--
-- WHAT THE SERVER LEARNS. One more integer per project. Still nothing about the
-- designs: the extension sends only the project id and +1 / -1. A design is
-- counted as failed once; if a retry later publishes it, the extension takes
-- it back (-1) so it isn't counted as both. After this migration the table may
-- hold exactly:
--     id, user_id, name, upload_count, failed_count, created_at, updated_at
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

-- ===========================================================================
-- 1. Column
-- ===========================================================================
alter table public.projects
  add column if not exists failed_count bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_failed_nonnegative') then
    alter table public.projects
      add constraint projects_failed_nonnegative check (failed_count >= 0);
  end if;
end;
$$;

comment on column public.projects.failed_count is
  'Designs whose upload failed under this project. Moved only by record_project_upload_failure().';

-- ===========================================================================
-- 2. Users never set it: a new project starts at 0, updates put it back
-- ===========================================================================
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = user_id and upload_count = 0 and failed_count = 0);

create or replace function public.projects_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.projects_increment', true), '') <> 'on' then
    new.upload_count := old.upload_count;
    new.failed_count := old.failed_count;
  end if;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 3. record_project_upload_failure(p_project, p_delta) - +1 or -1, never below 0
-- ===========================================================================
create or replace function public.record_project_upload_failure(p_project uuid, p_delta int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  failed  bigint;
  touched int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_delta not in (1, -1) then
    raise exception 'p_delta must be 1 or -1' using errcode = '22023';
  end if;

  perform set_config('app.projects_increment', 'on', true);
  update public.projects
     set failed_count = greatest(failed_count + p_delta, 0)
   where id = p_project and user_id = uid
  returning failed_count into failed;
  -- Read the row count straight away: the PERFORM below would reset FOUND.
  get diagnostics touched = row_count;
  perform set_config('app.projects_increment', 'off', true);
  if touched = 0 then
    raise exception 'project not found' using errcode = '42501';
  end if;

  return failed;
end;
$$;

revoke all on function public.record_project_upload_failure(uuid, int) from public;
grant execute on function public.record_project_upload_failure(uuid, int) to authenticated;
