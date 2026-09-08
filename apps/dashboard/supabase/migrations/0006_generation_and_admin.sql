-- 0006_generation_and_admin.sql
-- Two additions on top of 0005:
--   1. log_generation()   — lets a signed-in user record their OWN AI-generation
--      events (attempt / success / denied / failed) into activity_logs. Generation
--      runs client-side with the user's own Gemini key, so this logging is
--      best-effort (client-reported) — it is NOT an authoritative server gate.
--   2. admin_list_users() + admin_reactivate_user() — power the admin UI:
--      a computed, effective-status listing and an un-suspend action.
--
-- Idempotent. Run in Supabase SQL Editor or `supabase db push`.

-- ===========================================================================
-- 1. log_generation() — constrained self-logging for authenticated users
-- ===========================================================================
-- SECURITY DEFINER so it can insert into activity_logs, but it hard-codes the
-- action prefix and forces user_id = auth.uid(), so a user can only ever write
-- their OWN 'generation.*' rows — never arbitrary actions or other users' rows.
create or replace function public.log_generation(p_status text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('attempt','success','denied','failed') then
    raise exception 'invalid status %', p_status;
  end if;
  insert into public.activity_logs (user_id, actor_id, action, metadata)
  values (uid, uid, 'generation.' || p_status, coalesce(p_meta, '{}'::jsonb));
end; $$;

grant execute on function public.log_generation(text, jsonb) to authenticated;

-- ===========================================================================
-- 2. admin_list_users() — one call returns every user with EFFECTIVE status
-- ===========================================================================
-- compute_access(p) resolves trials by the DB clock, so the admin UI shows the
-- same "effective" status the app enforces (a 'trialing' row past trial_end
-- reads as 'expired'), not just the stored intent.
create or replace function public.admin_list_users()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'email',            p.email,
          'full_name',        p.full_name,
          'is_admin',         p.is_admin,
          'approved',         p.approved,
          'approved_at',      p.approved_at,
          'plan',             p.plan,
          'account_status',   p.account_status,
          'effective_status', public.compute_access(p) ->> 'status',
          'trial_end',        p.trial_end,
          'suspended_at',     p.suspended_at,
          'created_at',       p.created_at
        )
        order by p.created_at desc
      ),
      '[]'::jsonb
    )
    from public.profiles p
  );
end; $$;

grant execute on function public.admin_list_users() to authenticated;

-- ===========================================================================
-- 3. admin_reactivate_user() — lift a suspension / restore access
-- ===========================================================================
-- Recomputes the stored status from the user's plan + trial so a restored user
-- lands in the right state (active / trialing / expired / pending_approval).
create or replace function public.admin_reactivate_user(target uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.profiles p set
    suspended_at   = null,
    account_status = case
      when p.plan in ('pro_monthly','pro_yearly')            then 'active'
      when p.plan = 'trial' and p.trial_end > now()          then 'trialing'
      when p.plan = 'trial' and p.trial_end <= now()         then 'expired'
      when p.approved is true                                then 'trialing'
      else 'pending_approval'
    end
  where p.id = target;
  perform public.log_activity(target, 'admin.reactivate', '{}'::jsonb);
end; $$;

grant execute on function public.admin_reactivate_user(uuid) to authenticated;
