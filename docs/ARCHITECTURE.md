# TeePublic Uploader — SaaS Access Architecture

> **OUT OF DATE IN ONE IMPORTANT RESPECT.** This document describes designs,
> spreadsheet batches and artwork as living in Supabase (tables `designs`,
> `spreadsheet_batches`, and a Storage bucket named `designs`). They no longer
> do: all of it is stored locally in the user's browser, and Supabase holds only
> account/access data plus one aggregate upload count per user. See
> **Local-first data** in `CLAUDE.md`, `apps/dashboard/lib/localDb.ts`, and
> migrations `0009`–`0011`. The rest of this document — auth, access resolution,
> the admin RPCs — still applies.

Production-ready access-management design for the dashboard (Next.js 15 on Vercel),
the Chrome extension (MV3), and Supabase. **No payment gateway is wired up** — but
the schema and the access layer are shaped so Stripe, Paddle, or Lemon Squeezy can
be added later by writing *one webhook translator* and **zero schema changes**.

The golden rule everywhere below: **the client is never trusted.** Access is
resolved by one server-side function, `public.get_my_access()`, which the
dashboard, the API, and the extension all call.

---

## 1. Database schema

All of this ships as `apps/dashboard/supabase/migrations/0005_saas_access.sql`
(additive — it extends the existing `profiles` from `0001` and never breaks it).

### `profiles` (extended)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | → `auth.users.id`, cascade |
| `email` | text | synced from auth |
| `full_name` | text | from signup metadata |
| `avatar_url` | text | |
| `is_admin` | bool | **legacy, still authoritative** for admin gating |
| `role` | text | `user` \| `admin` \| `super_admin` (mirrors `is_admin`) |
| `approved` | bool | **legacy, still the approval gate** |
| `approved_at` | timestamptz | set on approval |
| `account_status` | text | `pending_verification` \| `pending_approval` \| `trialing` \| `active` \| `expired` \| `suspended` \| `cancelled` |
| `plan` | text | `none` \| `trial` \| `pro_monthly` \| `pro_yearly` |
| `trial_start` / `trial_end` | timestamptz | set **on approval**, not signup |
| `suspended_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | `updated_at` auto-touched |

> `account_status` is **stored intent**. The *effective* status (e.g. a `trialing`
> row whose `trial_end` has passed) is computed live by `get_my_access()`, so you
> never depend on a cron job to stay correct.

### `subscriptions` — provider-agnostic billing state
`id, user_id, provider (manual|stripe|paddle|lemonsqueezy), provider_customer_id,
provider_subscription_id, provider_price_id, plan, status
(trialing|active|past_due|canceled|expired|incomplete|paused),
current_period_start, current_period_end, cancel_at_period_end, canceled_at,
trial_end, metadata jsonb, timestamps`. UNIQUE `(provider, provider_subscription_id)`.

### `billing_events` — webhook idempotency ledger
`id, provider, event_id, type, payload jsonb, processed_at`. UNIQUE
`(provider, event_id)`. **RLS on, zero policies → service-role only.**

### `activity_logs` — audit trail
`id, user_id (subject), actor_id (who acted), action, target, metadata jsonb, ip,
created_at`. Written only through `log_activity()`.

### `user_settings` — per-user prefs
`user_id PK, theme, locale, notifications jsonb, preferences jsonb, updated_at`.
Auto-created at signup. Full user CRUD (this is genuinely user-owned).

### `roles` / `permissions` / `role_permissions` / `user_roles`
Optional granular RBAC for the future. `is_admin`/`role` on `profiles` is the
active mechanism today; these tables let you grow into fine-grained permissions
without another migration.

### Entity relationships
```
auth.users ─1:1─ profiles ─1:1─ user_settings
     │              │
     │              └─1:N─ designs, spreadsheet_batches   (existing)
     └─1:N─ subscriptions ─(writes from)→ billing_events
     └─1:N─ activity_logs
```

---

## 2. Folder structure

```
autotee/
├─ apps/
│  ├─ dashboard/                      # Next.js 15 (App Router) → Vercel
│  │  ├─ app/
│  │  │  ├─ (public)/                 # landing site (no auth) — see §8
│  │  │  │  ├─ page.tsx  features/  pricing/  extension/
│  │  │  │  ├─ how-it-works/  faq/  contact/
│  │  │  │  └─ legal/{privacy,terms,refund,cancellation}/
│  │  │  ├─ (auth)/login  (auth)/register
│  │  │  ├─ (app)/dashboard/          # gated app
│  │  │  ├─ (states)/pending  /trial-expired  /suspended
│  │  │  ├─ admin/                    # admins only
│  │  │  └─ api/
│  │  │     ├─ auth/{login,logout,me,register}
│  │  │     ├─ admin/users            # service-role admin ops
│  │  │     ├─ access                 # thin wrapper over get_my_access()
│  │  │     └─ billing/webhook/[provider]   # ← future, stub today
│  │  ├─ lib/
│  │  │  ├─ supabase/{client,server,admin,middleware}.ts
│  │  │  ├─ access.ts                 # getAccess(): calls get_my_access()
│  │  │  └─ auth.ts
│  │  ├─ middleware.ts                # route gating (§5)
│  │  └─ supabase/migrations/*.sql    # 0001..0005
│  └─ extension/                      # MV3
│     └─ src/
│        ├─ background/index.ts       # holds Supabase session, polls access
│        ├─ popup/                    # login (same account) + lock/unlock UI
│        ├─ content/teepublic.ts      # automation (gated)
│        └─ lib/supabaseClient.ts     # chrome.storage-backed session
└─ packages/shared/                   # types shared dashboard ↔ extension
   └─ src/{types,protocol,access}.ts  # AccessState type lives here
```

---

## 3. Supabase objects (what runs where)

| Object | Kind | Purpose |
|---|---|---|
| `get_my_access()` | RPC (definer) | **single source of truth**; returns effective `{status, plan, can_access, …}` |
| `compute_access(profile)` | fn (definer) | pure resolver used by the above |
| `is_admin()` | fn (definer) | non-recursive admin check for RLS + RPCs |
| `log_activity()` | fn (definer) | audit insert |
| `admin_approve_user / reject / suspend / extend_trial / grant_plan / revoke_access` | RPC (definer) | the **only** way to mutate sensitive columns |
| `handle_new_user` / `handle_email_confirmed` | triggers | seed profile + settings; advance status on verify |
| RLS policies | — | read-own everywhere; admin read-all; no user writes to sensitive tables |
| Storage bucket `designs` | — | existing; keep access-gated (§6) |

---

## 4. Authentication flow

```
Sign up (email+pw)
  → profiles row auto-created, account_status = pending_verification
Verify email (Supabase)
  → handle_email_confirmed trigger → account_status = pending_approval
Sign in
  → middleware: get_my_access().status = pending_approval → /pending
Admin approves (admin_approve_user)
  → approved=true, approved_at=now
  → trial_start=now, trial_end=now+7d, plan=trial, account_status=trialing
Sign in again
  → status = trialing, can_access=true → dashboard + extension unlocked
Trial ends (clock)
  → get_my_access() returns expired → dashboard limited, extension locked
Later: payment provider webhook
  → subscriptions row active + profiles.plan=pro_*  → status=active
```

Keep Supabase **“Confirm email” ON**; unconfirmed users can’t obtain a session,
so `pending_verification` is enforced by Supabase itself.

---

## 5. Dashboard flow

`middleware.ts` gates every non-API route using `get_my_access()` (upgrade of your
current `approved/is_admin` check — same shape, richer states):

```ts
// lib/access.ts
export type AccessStatus =
  | 'pending_verification' | 'pending_approval' | 'trialing'
  | 'active' | 'expired' | 'suspended' | 'cancelled';

export async function getAccess(supabase) {
  const { data } = await supabase.rpc('get_my_access');
  return data as {
    status: AccessStatus; plan: string; can_access: boolean;
    is_admin: boolean; email_verified: boolean; trial_end: string | null;
  } | null;
}
```

```ts
// middleware.ts routing table (after supabase.auth.getUser())
const a = await getAccess(supabase);            // one RPC, server-side
switch (a?.status) {
  case undefined:               return redirect('/login?next=…'); // signed out
  case 'pending_verification':  return redirect('/verify-email');
  case 'pending_approval':      return redirect('/pending');
  case 'suspended':             return redirect('/suspended');
  case 'cancelled':
  case 'expired':               return redirect('/trial-expired'); // limited UI
  case 'trialing':
  case 'active':                return next();                     // full app
}
// /admin/* additionally requires a.is_admin === true
```

- **`can_access === true`** (`trialing`/`active`) → full dashboard + “Send to
  extension” enabled.
- **`expired`/`cancelled`** → `/trial-expired`: read-only view of past designs,
  an **Upgrade** CTA (pricing), no new generation / no extension push.
- **`suspended`** → `/suspended` dead-end with support contact.

Never gate on client state alone — the RPC is the gate; the pages are just UX.

---

## 6. Extension flow (secure, MV3)

The extension uses the **same Supabase auth** — the user signs into the popup with
the same email/password. The session lives in `chrome.storage` (custom storage
adapter for `supabase-js`), and the background service worker owns it.

```
Popup login (same account)
  → supabase.auth.signInWithPassword  → session in chrome.storage
Background worker, on startup + every 15 min + before each run:
  → supabase.rpc('get_my_access')
  → cache { can_access, status } in chrome.storage.session (short TTL)
Content script wants to automate teepublic.com:
  → asks background “am I allowed?” → background returns cached access
  → can_access ? run automation : show locked overlay + Upgrade link
```

**Why this is actually secure (not just a client checkbox):** the extension runs
on the user’s machine, so a determined user can flip a client boolean. The real
boundary is **every server resource the extension needs is independently gated**:

- Designs/images the extension consumes come from Supabase (RLS-scoped to the
  user) or from the dashboard (already access-gated).
- Any server action (design generation, uploads, listing sync) checks
  `get_my_access().can_access` **on the server** before doing work.

So “unlocking” the client yields an empty shell — no data, no server features.
The client gate is UX; the server gate is security. Enforce both.

Manifest already allows `https://*.supabase.co/*`, so no manifest change is
needed for the extension to call the RPC directly.

---

## 7. Admin flow

Two equally valid mechanisms — use whichever fits the call site:

1. **Admin RPCs** (recommended for the admin UI): callable with the admin’s own
   JWT via `supabase.rpc('admin_approve_user', { target, trial_days: 7 })`. Each
   RPC re-checks `is_admin()` server-side and writes an `activity_logs` row. No
   service-role key in the browser.
2. **Service-role API routes** (your existing `app/api/admin/users`): keep for
   things RPCs can’t do — listing *all* auth users and `auth.admin.deleteUser`.

| Admin action | How |
|---|---|
| View users / status / trial expiry | `GET /api/admin/users` (service role) or admin read-all RLS |
| Approve user (starts 7-day trial) | `admin_approve_user(id, 7)` |
| Reject user | `admin_reject_user(id)` |
| Suspend user | `admin_suspend_user(id)` |
| Activate / extend trial | `admin_extend_trial(id, days)` |
| Grant Pro Monthly / Yearly | `admin_grant_plan(id, 'pro_monthly'\|'pro_yearly', months)` |
| Remove access | `admin_revoke_access(id)` |
| Delete account | `DELETE /api/admin/users` → `auth.admin.deleteUser` |

Guardrails already in your code (can’t revoke/delete yourself) stay; add the same
check to the RPCs if you expose destructive ones.

---

## 8. Landing page structure (public, un-gated)

Grouped under `app/(public)/` so `middleware.ts` skips auth for them. Industry-
standard SaaS set:

- **Home** — hero + value prop, social proof, primary CTA (Start free trial), feature teasers, footer.
- **Features** — capability grid (batch upload, AI listings, spreadsheet import, color automation).
- **Pricing** — 3 cards (§9). Buttons are inert today.
- **Chrome Extension** — what it does, install steps, permissions explainer, screenshots.
- **How it Works** — 3–4 step walkthrough (Generate → Review → Send to extension → Auto-upload).
- **FAQ** — trial, approval, refunds, data handling, TeePublic ToS.
- **Contact** — form → email/Supabase table.
- **Legal**: Privacy Policy, Terms, Refund Policy, Cancellation Policy (required
  before you ever turn on payments — providers demand these URLs).

SEO: static/SSG these routes, per-page `metadata`, sitemap, OG tags.

---

## 9. Pricing (cards only — no payments)

| Card | Plan value | CTA (today) |
|---|---|---|
| **Free Trial** | `trial` | “Start free trial” → register |
| **Pro Monthly** | `pro_monthly` | “Upgrade” → inert / “coming soon” |
| **Pro Yearly** | `pro_yearly` | “Upgrade” → inert / “coming soon” |

Wire each button to a single stub:

```ts
// lib/checkout.ts — swap the body per provider later; callers never change.
export async function startCheckout(plan: 'pro_monthly' | 'pro_yearly') {
  // TODO(payments): POST /api/billing/checkout { plan } → provider session URL
  return { ok: false, reason: 'coming_soon' as const };
}
```

Because plan identity lives in *your* `plan` enum (not the provider’s price id),
switching providers never touches the pricing UI.

---

## 10. Future payment architecture (drop-in)

```
Provider Checkout ──webhook──► /api/billing/webhook/[provider]
   (stripe|paddle|lemonsqueezy)          │
                                         ├─ verify signature (provider secret)
                                         ├─ insert billing_events (UNIQUE → idempotent)
                                         ├─ TRANSLATE provider payload → normalized fields
                                         └─ upsert subscriptions + update profiles.plan/account_status
                                                        │
                                          get_my_access() reads it → app/extension unlock instantly
```

Adding a provider = implement one translator:

```ts
// lib/billing/providers/stripe.ts  (paddle.ts, lemonsqueezy.ts are siblings)
export const stripe: BillingProvider = {
  verify(req) { /* Stripe-Signature */ },
  toSubscription(evt) {
    return {
      provider: 'stripe',
      provider_customer_id: evt.customer,
      provider_subscription_id: evt.subscription,
      plan: PRICE_TO_PLAN[evt.price_id],          // map THEIR price → YOUR plan
      status: STATUS_MAP[evt.status],             // map THEIR status → YOURS
      current_period_end: new Date(evt.current_period_end * 1000).toISOString(),
      cancel_at_period_end: evt.cancel_at_period_end,
    };
  },
};
```

The webhook route, `subscriptions`/`billing_events` tables, `profiles.plan`, and
`get_my_access()` are provider-neutral. **Nothing about the DB or access logic
changes** when you pick a provider — you register a translator. You can even run
two providers at once (the `provider` column disambiguates).

Manual grants already flow through the same `subscriptions` table
(`provider='manual'`), so admin comps and real subscriptions resolve identically.

---

## 11. Security architecture

- **RLS on by default, deny-by-default.** No table grants blanket access.
- **`profiles`:** read own + admin read-all; **no user UPDATE policy at all** →
  `plan`, `trial_*`, `account_status`, `approved` are physically unwritable by
  users. Only `SECURITY DEFINER` admin RPCs (which check `is_admin()`) and the
  service role can change them.
- **`subscriptions`:** read own only; writes are service-role/RPC only. Users
  can’t self-upgrade.
- **`billing_events`:** RLS on, zero policies → service-role only.
- **`is_admin()` is `SECURITY DEFINER`** and owned by `postgres`, so RLS policies
  can call it without recursing into the `profiles` SELECT policy.
- **Service-role key is server-only** (`SUPABASE_SERVICE_ROLE_KEY`, no
  `NEXT_PUBLIC_`), imported only by `lib/supabase/admin.ts`. Never shipped to the
  browser or the extension.
- **Middleware uses `auth.getUser()`** (revalidates the JWT), not `getSession()`.
- **Extension** stores the session in `chrome.storage`, calls `get_my_access()`;
  all server features it uses are independently access-gated (§6).
- **Webhooks** verify provider signatures and dedupe via `billing_events`.
- **Audit:** every admin/billing mutation writes `activity_logs`.
- **Least privilege for admin:** keep the “can’t revoke/delete yourself” guards.

Threats explicitly closed: self-approval, self-upgrade, trial extension by client,
replayed webhooks, admin escalation via RLS recursion, service-role leakage.

---

## 12. Recommended best practices

1. **One access function, everywhere.** Dashboard, API, and extension all call
   `get_my_access()`. Never reimplement the rules client-side.
2. **Store intent, compute effect.** Keep `account_status` as intent; let trial
   expiry be resolved by the clock in `compute_access()`. The optional `pg_cron`
   job is only for tidy admin listings/emails.
3. **Provider-neutral plan identity.** Your `plan` enum is the currency; provider
   price ids are just mapped to it. This is what makes payments swappable.
4. **Idempotent webhooks.** `UNIQUE(provider, event_id)` + upsert. Assume every
   event arrives 0..N times.
5. **Ship legal pages before payments.** Providers require Privacy/Terms/Refund/
   Cancellation URLs at onboarding.
6. **(Scale) Put `is_admin`/`can_access` in the JWT** via a Custom Access Token
   Hook to avoid a DB read per middleware request once you pass a few thousand
   DAU. `get_my_access()` stays the source of truth; the JWT is a cache.
7. **Migrations are forward-only and idempotent** (this repo’s convention:
   `if not exists`, `drop policy if exists`, `create or replace`).
8. **Test the matrix:** unverified / pending / trialing / expired / suspended /
   cancelled / pro — for both dashboard routes and extension unlock.
9. **Rate-limit** auth + webhook routes; log auth events to `activity_logs`.
10. **Backups + PITR** on Supabase; treat `SUPABASE_SERVICE_ROLE_KEY` as a
    top-tier secret and rotate on any exposure.
```
