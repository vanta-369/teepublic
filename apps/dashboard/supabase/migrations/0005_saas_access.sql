-- 0005_saas_access.sql
-- Production SaaS access-management layer, built on top of the existing
-- approval system (0001) WITHOUT breaking it.
--
-- What this adds:
--   * profiles: trial / plan / account_status / role + audit timestamps
--   * subscriptions:   provider-agnostic billing state (Stripe / Paddle / LS / manual)
--   * billing_events:  webhook idempotency ledger (service-role only)
--   * activity_logs:   who-did-what audit trail
--   * user_settings:   per-user preferences
--   * roles / permissions / user_roles: optional granular RBAC (future)
--   * get_my_access(): THE single source of truth for "can this user use the app"
--   * admin_* RPCs:    approve / suspend / trial / grant-plan, all audited
--
-- Design rule: users may NEVER write plan / trial / status / approval. Those
-- columns are mutated ONLY by SECURITY DEFINER functions that check is_admin(),
-- or by the service role (webhooks). RLS denies everything else by default.
--
-- Run in Supabase SQL Editor (paste + Run) or `supabase db push`. Idempotent.

-- ===========================================================================
-- 0. Extensions
-- ===========================================================================
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ===========================================================================
-- 1. profiles — extend the existing table (0001) with SaaS columns
-- ===========================================================================
alter table public.profiles
  add column if not exists full_name         text,
  add column if not exists avatar_url         text,
  add column if not exists role               text        not null default 'user',
  add column if not exists account_status     text        not null default 'pending_verification',
  add column if not exists plan               text        not null default 'none',
  add column if not exists trial_start        timestamptz,
  add column if not exists trial_end          timestamptz,
  add column if not exists approved_at        timestamptz,
  add column if not exists suspended_at       timestamptz,
  add column if not exists updated_at         timestamptz not null default now();

-- Value guards. Using text + CHECK (not enums) so new plans/statuses can be
-- added later by replacing the constraint — no ALTER TYPE dance, no downtime.
do $$ begin
  alter table public.profiles
    add constraint profiles_account_status_chk check (account_status in (
      'pending_verification','pending_approval','trialing','active',
      'expired','suspended','cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_plan_chk check (plan in (
      'none','trial','pro_monthly','pro_yearly'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_role_chk check (role in ('user','admin','super_admin'));
exception when duplicate_object then null; end $$;

comment on column public.profiles.account_status is
  'Stored intent set by admin/billing. EFFECTIVE access is computed by get_my_access() (trials expire dynamically).';

-- Keep the legacy is_admin boolean in sync with the new role column.
update public.profiles set role = 'admin' where is_admin = true and role = 'user';

-- ---- Backfill existing rows (EDIT to taste before running in prod) ---------
-- Admins -> active. Already-approved users -> a fresh 7-day trial. Everyone
-- else -> pending_approval (email is already confirmed by this point in prod).
update public.profiles
set account_status = 'active', plan = coalesce(nullif(plan,'none'),'pro_yearly')
where is_admin = true and account_status = 'pending_verification';

update public.profiles
set account_status = 'trialing',
    plan           = 'trial',
    trial_start    = coalesce(trial_start, now()),
    trial_end      = coalesce(trial_end, now() + interval '7 days'),
    approved_at    = coalesce(approved_at, created_at)
where approved = true and is_admin = false and account_status = 'pending_verification';

update public.profiles
set account_status = 'pending_approval'
where approved = false and account_status = 'pending_verification';

-- ===========================================================================
-- 2. subscriptions — provider-agnostic billing state
-- ===========================================================================
-- The ENTIRE point of this table: payment providers write here via webhooks,
-- normalising their own vocabulary into these columns. Access logic never reads
-- provider-specific fields, so swapping Stripe <-> Paddle <-> Lemon Squeezy
-- changes ONLY the webhook translator, never the schema or the app.
create table if not exists public.subscriptions (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null references auth.users (id) on delete cascade,
  provider                  text        not null default 'manual'
                              check (provider in ('manual','stripe','paddle','lemonsqueezy')),
  provider_customer_id      text,
  provider_subscription_id  text,
  provider_price_id         text,
  plan                      text        not null default 'none'
                              check (plan in ('none','trial','pro_monthly','pro_yearly')),
  status                    text        not null default 'incomplete'
                              check (status in ('trialing','active','past_due',
                                                'canceled','expired','incomplete','paused')),
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean     not null default false,
  canceled_at               timestamptz,
  trial_end                 timestamptz,
  metadata                  jsonb       not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists subscriptions_user_idx    on public.subscriptions (user_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (provider, provider_customer_id);

comment on table public.subscriptions is
  'Normalised billing state. Written by webhooks (service role) or admin RPCs; users have read-only access to their own rows.';

-- ===========================================================================
-- 3. billing_events — webhook idempotency ledger (service-role only)
-- ===========================================================================
create table if not exists public.billing_events (
  id           uuid        primary key default gen_random_uuid(),
  provider     text        not null,
  event_id     text        not null,      -- provider's event id, for dedupe
  type         text,
  payload      jsonb       not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (provider, event_id)
);
comment on table public.billing_events is
  'Raw provider webhook events. UNIQUE(provider,event_id) makes handlers idempotent. No RLS policies => users cannot read it.';

-- ===========================================================================
-- 4. activity_logs — audit trail
-- ===========================================================================
create table if not exists public.activity_logs (
  id         bigint      generated always as identity primary key,
  user_id    uuid        references auth.users (id) on delete set null,  -- subject
  actor_id   uuid        references auth.users (id) on delete set null,  -- who acted
  action     text        not null,          -- e.g. 'admin.approve', 'auth.login'
  target     text,
  metadata   jsonb       not null default '{}'::jsonb,
  ip         inet,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_user_idx    on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_action_idx  on public.activity_logs (action, created_at desc);

-- ===========================================================================
-- 5. user_settings — per-user preferences
-- ===========================================================================
create table if not exists public.user_settings (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  theme         text        not null default 'system',
  locale        text,
  notifications jsonb       not null default '{}'::jsonb,
  preferences   jsonb       not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- ===========================================================================
-- 6. Optional granular RBAC (future). is_admin/role on profiles is the ACTIVE
--    mechanism today; these tables let you grow into fine-grained permissions
--    without another schema change.
-- ===========================================================================
create table if not exists public.roles (
  key text primary key, description text
);
create table if not exists public.permissions (
  key text primary key, description text
);
create table if not exists public.role_permissions (
  role_key       text references public.roles (key)       on delete cascade,
  permission_key text references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);
create table if not exists public.user_roles (
  user_id  uuid references auth.users (id) on delete cascade,
  role_key text references public.roles (key) on delete cascade,
  primary key (user_id, role_key)
);

insert into public.roles (key, description) values
  ('user','Standard end user'),
  ('admin','Full admin dashboard access'),
  ('super_admin','Can manage other admins')
on conflict (key) do nothing;

-- ===========================================================================
-- 7. Helpers: updated_at, is_admin(), log_activity()
-- ===========================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_profiles_touch      on public.profiles;
create trigger trg_profiles_touch      before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_subscriptions_touch on public.subscriptions;
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_user_settings_touch on public.user_settings;
create trigger trg_user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- SECURITY DEFINER + owned by postgres => runs without RLS on public.*, so a
-- policy that calls is_admin() will NOT recurse into the profiles SELECT policy.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.log_activity(subject uuid, action text, meta jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_logs (user_id, actor_id, action, metadata)
  values (subject, auth.uid(), action, coalesce(meta, '{}'::jsonb));
end; $$;

-- ===========================================================================
-- 8. get_my_access() — THE SINGLE SOURCE OF TRUTH
-- ===========================================================================
-- Dashboard middleware, API routes, AND the Chrome extension all call this.
-- It resolves the EFFECTIVE entitlement (trials expire by clock, not by cron)
-- so nothing downstream has to reimplement the rules. Never trust the client.
create or replace function public.compute_access(p public.profiles)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  now_ts   timestamptz := now();
  verified boolean;
  eff      text;
  paid_ok  boolean;
begin
  select (u.email_confirmed_at is not null) into verified
  from auth.users u where u.id = p.id;

  paid_ok := exists (
    select 1 from public.subscriptions s
    where s.user_id = p.id
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now_ts)
  );

  eff := case
    when p.account_status = 'suspended'                       then 'suspended'
    when p.account_status = 'cancelled'                       then 'cancelled'
    when coalesce(verified, false) = false                    then 'pending_verification'
    when p.approved is not true                               then 'pending_approval'
    when p.plan in ('pro_monthly','pro_yearly') and paid_ok   then 'active'
    when p.plan = 'trial' and p.trial_end > now_ts            then 'trialing'
    when p.plan = 'trial' and p.trial_end <= now_ts           then 'expired'
    else coalesce(nullif(p.account_status,''), 'pending_approval')
  end;

  return jsonb_build_object(
    'user_id',        p.id,
    'email',          p.email,
    'status',         eff,
    'plan',           p.plan,
    'can_access',     eff in ('trialing','active'),
    'is_admin',       p.is_admin,
    'email_verified', coalesce(verified, false),
    'approved',       p.approved,
    'trial_end',      p.trial_end,
    'checked_at',     now_ts
  );
end; $$;

create or replace function public.get_my_access()
returns jsonb
language sql stable security definer set search_path = public as $$
  select public.compute_access(p) from public.profiles p where p.id = auth.uid();
$$;

grant execute on function public.get_my_access() to authenticated;

-- ===========================================================================
-- 9. Signup wiring — extend handle_new_user() (from 0001) to seed settings
--    and set the initial status. Email-confirmation flips to pending_approval.
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, account_status)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          case when new.email_confirmed_at is not null
               then 'pending_approval' else 'pending_verification' end)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

-- When the user confirms their email, advance the status.
create or replace function public.handle_email_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles
      set account_status = 'pending_approval'
      where id = new.id and account_status = 'pending_verification';
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_email_confirmed();

-- ===========================================================================
-- 10. Admin RPCs — the ONLY sanctioned way to mutate sensitive columns.
--     Callable from the admin UI with the admin's own JWT (no service role in
--     the browser). Each checks is_admin() and writes an audit log.
-- ===========================================================================
create or replace function public.admin_approve_user(target uuid, trial_days int default 7)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.profiles p set
    approved       = true,
    approved_at    = coalesce(p.approved_at, now()),
    trial_start    = case when p.trial_start is null then now() else p.trial_start end,
    trial_end      = case when p.trial_start is null then now() + make_interval(days => trial_days) else p.trial_end end,
    plan           = case when p.plan = 'none' then 'trial' else p.plan end,
    account_status = case when p.plan in ('pro_monthly','pro_yearly') then 'active' else 'trialing' end
  where p.id = target;
  perform public.log_activity(target, 'admin.approve', jsonb_build_object('trial_days', trial_days));
end; $$;

create or replace function public.admin_reject_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.profiles set approved = false, account_status = 'cancelled' where id = target;
  perform public.log_activity(target, 'admin.reject', '{}'::jsonb);
end; $$;

create or replace function public.admin_suspend_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.profiles set account_status = 'suspended', suspended_at = now() where id = target;
  perform public.log_activity(target, 'admin.suspend', '{}'::jsonb);
end; $$;

create or replace function public.admin_extend_trial(target uuid, add_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.profiles p set
    plan           = 'trial',
    trial_start    = coalesce(p.trial_start, now()),
    trial_end      = greatest(coalesce(p.trial_end, now()), now()) + make_interval(days => add_days),
    account_status = 'trialing'
  where p.id = target;
  perform public.log_activity(target, 'admin.extend_trial', jsonb_build_object('add_days', add_days));
end; $$;

-- Grant a paid plan manually (also records a 'manual' subscription so
-- get_my_access() sees an active period, exactly like a real provider would).
create or replace function public.admin_grant_plan(target uuid, new_plan text, months int default 1)
returns void language plpgsql security definer set search_path = public as $$
declare period_end timestamptz := now() + make_interval(months => months);
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if new_plan not in ('pro_monthly','pro_yearly') then raise exception 'bad plan %', new_plan; end if;

  update public.profiles set plan = new_plan, account_status = 'active', approved = true,
         approved_at = coalesce(approved_at, now())
  where id = target;

  insert into public.subscriptions (user_id, provider, plan, status, current_period_start, current_period_end)
  values (target, 'manual', new_plan, 'active', now(), period_end);

  perform public.log_activity(target, 'admin.grant_plan', jsonb_build_object('plan', new_plan, 'months', months));
end; $$;

create or replace function public.admin_revoke_access(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.profiles set account_status = 'cancelled', plan = 'none' where id = target;
  update public.subscriptions set status = 'canceled', canceled_at = now()
    where user_id = target and status in ('active','trialing');
  perform public.log_activity(target, 'admin.revoke', '{}'::jsonb);
end; $$;

grant execute on function
  public.admin_approve_user(uuid,int),
  public.admin_reject_user(uuid),
  public.admin_suspend_user(uuid),
  public.admin_extend_trial(uuid,int),
  public.admin_grant_plan(uuid,text,int),
  public.admin_revoke_access(uuid)
to authenticated;   -- body still enforces is_admin(); non-admins get 42501.

-- ===========================================================================
-- 11. Row Level Security
-- ===========================================================================

-- profiles: keep "Read own profile" (0001); add admin read-all. NO user
-- UPDATE policy exists => sensitive columns are unwritable except via RPCs.
alter table public.profiles enable row level security;
drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select to authenticated using (public.is_admin());

-- subscriptions: read own only. Writes = service role / admin RPC only.
alter table public.subscriptions enable row level security;
drop policy if exists subs_select_own   on public.subscriptions;
create policy subs_select_own   on public.subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists subs_admin_read    on public.subscriptions;
create policy subs_admin_read    on public.subscriptions for select to authenticated using (public.is_admin());

-- activity_logs: read own; admins read all. Inserts via log_activity() only.
alter table public.activity_logs enable row level security;
drop policy if exists logs_select_own  on public.activity_logs;
create policy logs_select_own  on public.activity_logs for select to authenticated using (auth.uid() = user_id);
drop policy if exists logs_admin_read   on public.activity_logs;
create policy logs_admin_read   on public.activity_logs for select to authenticated using (public.is_admin());

-- user_settings: full CRUD on own row (this IS user-owned data).
alter table public.user_settings enable row level security;
drop policy if exists settings_all_own on public.user_settings;
create policy settings_all_own on public.user_settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- billing_events: RLS on, ZERO policies => only the service role can touch it.
alter table public.billing_events enable row level security;

-- RBAC catalog tables: readable by any signed-in user, managed by service role.
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);

-- ===========================================================================
-- 12. OPTIONAL: nightly job to persist trialing -> expired for accurate admin
--     listings / expiry emails. get_my_access() is already correct without it,
--     so this is only for reporting. Requires pg_cron (Supabase: enable in
--     Database -> Extensions).
-- ===========================================================================
-- select cron.schedule('expire-trials','5 0 * * *', $$
--   update public.profiles set account_status = 'expired'
--   where plan = 'trial' and account_status = 'trialing' and trial_end <= now();
-- $$);
