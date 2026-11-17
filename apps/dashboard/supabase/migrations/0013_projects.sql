-- 0013_projects.sql
-- Projects: one per TeePublic account a seller runs (e.g. "Baseball").
--
-- WHAT THE SERVER LEARNS. A project's NAME (a label the seller types) and how
-- many designs it has published. Nothing about the designs: no title, filename,
-- image, listing URL or product configuration - those stay in the browser, as
-- the Privacy Policy promises. This table may hold exactly:
--     id, user_id, name, upload_count, created_at, updated_at
--
-- The count moves only through increment_project_upload_count(), which also
-- adds to the account total (upload_stats), so the total stays the sum of
-- everything published. Users can name, rename and delete their projects, but
-- never set a count.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

-- ===========================================================================
-- 1. Table
-- ===========================================================================
create table if not exists public.projects (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name         text        not null,
  upload_count bigint      not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint projects_count_nonnegative check (upload_count >= 0)
);

create unique index if not exists projects_user_name_unique
  on public.projects (user_id, lower(btrim(name)));

comment on table public.projects is
  'One row per seller project (a TeePublic account). Holds only a name and a published-designs count - no design, listing or image data.';
comment on column public.projects.upload_count is
  'Designs published under this project. Incremented only by increment_project_upload_count().';

-- ===========================================================================
-- 2. Row Level Security - own rows only
-- ===========================================================================
alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- A new project starts at 0 and belongs to the caller.
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = user_id and upload_count = 0);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
  on public.projects for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
  on public.projects for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- A user update may change the name, nothing else: the count and the owner are
-- put back. The SECURITY DEFINER increment below runs as the table owner and
-- sets app.projects_increment so the trigger lets its new count through.
create or replace function public.projects_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.projects_increment', true), '') <> 'on' then
    new.upload_count := old.upload_count;
  end if;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_guard_update on public.projects;
create trigger projects_guard_update
  before update on public.projects
  for each row execute function public.projects_guard_update();

-- ===========================================================================
-- 3. increment_project_upload_count(p_project) - the only way a count moves
-- ===========================================================================
-- Adds 1 to the caller's project AND to the caller's account total. The caller
-- names only the project; the account comes from auth.uid(), and a project that
-- is not the caller's is refused. Same atomic upsert as increment_upload_count().
create or replace function public.increment_project_upload_count(p_project uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  total   bigint;
  touched int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform set_config('app.projects_increment', 'on', true);
  update public.projects
     set upload_count = upload_count + 1
   where id = p_project and user_id = uid;
  -- Read the row count straight away: the PERFORM below would reset FOUND.
  get diagnostics touched = row_count;
  perform set_config('app.projects_increment', 'off', true);
  if touched = 0 then
    raise exception 'project not found' using errcode = '42501';
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

revoke all on function public.increment_project_upload_count(uuid) from public;
grant execute on function public.increment_project_upload_count(uuid) to authenticated;
