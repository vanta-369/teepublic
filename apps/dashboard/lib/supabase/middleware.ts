// Session refresh + route gating for the Edge middleware.
//
// On every matched request we:
//   1. Refresh the Supabase session and write any rotated auth cookies.
//   2. Resolve access by calling public.get_my_access() LIVE — never a cached
//      plan/status, never a cookie value. The database is the source of truth.
//   3. Route by the EFFECTIVE status:
//        signed out            -> /login (with ?next=)
//        pending_verification  -> /verify-email
//        pending_approval      -> /pending
//        expired | cancelled   -> /trial-expired   (dashboard becomes limited)
//        suspended             -> /suspended
//        trialing | active     -> full app
//        /admin/*              -> admins only
//
// IMPORTANT: use supabase.auth.getUser() (not getSession()) here — it
// revalidates the token with Supabase instead of trusting the cookie.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import type { AccessState } from "@teepublic/shared";

const LOGIN = "/signin";
const VERIFY = "/verify-email";
const PENDING = "/pending";
const EXPIRED = "/trial-expired";
const SUSPENDED = "/suspended";
const ADMIN_PREFIX = "/admin";
const HOME = "/dashboard";

// Pages that exist only to explain a blocked state. A user is allowed to see
// exactly the one that matches their status, and nothing else.
const STATE_PAGES = [VERIFY, PENDING, EXPIRED, SUSPENDED];

// Routes that must NOT trigger the access RPC (to avoid needless latency):
// auth callbacks and public/marketing/auth pages. Static assets and /api are
// already excluded by the matcher in middleware.ts. `/` is the marketing home.
const PUBLIC_PREFIXES = [
  "/auth",
  "/", // marketing home (exact match only)
  "/how-it-works",
  "/pricing",
  "/about",
  "/faq",
  "/contact",
  "/privacy",
  "/terms",
  "/download-extension",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/login", // legacy — the /login page redirects to /signin
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Where a given access state is allowed to land. null = full app access.
// NOTE: this is only ever called for a SIGNED-IN user, so a null access means
// "no profile row / get_my_access() unavailable" (e.g. migration 0005 not yet
// applied) — send them to /pending, never /login (that would redirect-loop).
function gatePathFor(access: AccessState | null): string | null {
  if (!access) return PENDING;
  if (access.is_admin) return null; // staff bypass all plan gates
  switch (access.status) {
    case "trialing":
    case "active":
      return null;
    case "pending_verification":
      return VERIFY;
    case "pending_approval":
      return PENDING;
    case "expired":
    case "cancelled":
      return EXPIRED;
    case "suspended":
      return SUSPENDED;
    default:
      return PENDING;
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Redirect helper that carries any refreshed auth cookies along.
  const redirectTo = (pathname: string, withNext = false) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    if (withNext) {
      url.searchParams.set(
        "next",
        request.nextUrl.pathname + request.nextUrl.search,
      );
    }
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const { pathname } = request.nextUrl;

  // Public / auth-callback routes: refresh the session but DON'T call the access
  // RPC — these must stay fast and work signed-out.
  if (isPublicPath(pathname)) return supabaseResponse;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = pathname === LOGIN;
  const isAdminArea =
    pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);

  // --- Signed out -----------------------------------------------------------
  if (!user) {
    if (isLogin) return supabaseResponse;
    return redirectTo(LOGIN, true);
  }

  // Signed-in users never sit on the login/signup page. Bounce to HOME WITHOUT
  // an access RPC here — the HOME request resolves access and routes onward.
  if (isLogin) return redirectTo(HOME);

  // --- Signed in: resolve EFFECTIVE access from the DB (single source) -------
  const access = await getAccess(supabase);
  const target = gatePathFor(access); // null = allowed into the app
  const isAdmin = access?.is_admin === true;

  // Admin area is admins-only, regardless of plan.
  if (isAdminArea) {
    if (isAdmin) return supabaseResponse;
    return redirectTo(target ?? HOME);
  }

  // Allowed into the app: keep them off the blocked-state pages.
  if (target === null) {
    if (STATE_PAGES.includes(pathname)) return redirectTo(HOME);
    return supabaseResponse;
  }

  // Blocked: allow ONLY the state page that matches their status.
  if (pathname === target) return supabaseResponse;
  return redirectTo(target);
}
