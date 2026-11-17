-- 0012_expire_paid_plans.sql
-- Paid plans now END when their subscription period ends.
--
-- THE BUG. compute_access() (0005) only granted 'active' to a pro plan while a
-- subscription row was current (paid_ok). Once current_period_end passed, no
-- branch matched and the final ELSE returned profiles.account_status — which
-- admin_grant_plan() had set to 'active'. So an ended paid plan resolved to
-- 'active', can_access stayed true, and the dashboard and the extension both
-- let the account keep uploading indefinitely.
--
-- THE FIX, two rules:
--   1. A pro plan without a current subscription period is 'expired'.
--   2. The ELSE fallback can no longer grant access. Access comes ONLY from the
--      explicit branches above it (a current paid period, or an unexpired
--      trial); a stored 'active'/'trialing' that no branch backs is 'expired'.
--
-- Nothing else changes: same signature, same return shape (AccessState in
-- packages/shared/src/access.ts), and get_my_access() picks it up as-is. No
-- data is modified — profiles keep their stored status; only the computed,
-- effective status changes.
--
-- Renewing: admin_grant_plan() inserts a fresh subscription period, so a
-- re-granted (or provider-renewed) account is 'active' again immediately.
--
-- Idempotent + forward-only. Run in Supabase SQL Editor, or `supabase db push`.

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
    when p.account_status = 'suspended'                         then 'suspended'
    when p.account_status = 'cancelled'                         then 'cancelled'
    when coalesce(verified, false) = false                      then 'pending_verification'
    when p.approved is not true                                 then 'pending_approval'
    when p.plan in ('pro_monthly','pro_yearly') and paid_ok     then 'active'
    when p.plan in ('pro_monthly','pro_yearly')                 then 'expired'   -- (1)
    when p.plan = 'trial' and p.trial_end > now_ts              then 'trialing'
    when p.plan = 'trial'                                       then 'expired'   -- ended, or no end date
    -- (2) Never grant from the stored column alone.
    when p.account_status in ('active','trialing')              then 'expired'
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
