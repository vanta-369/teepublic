// A fetch wrapper that refuses to send artwork or listing content to Supabase.
//
// The privacy promise is structural, not aspirational: designs, titles, tags,
// prices and product configuration live in the user's browser and Supabase
// holds only account and access data plus one aggregate upload count. This is
// the enforcement point for that promise on the wire. Every Supabase client in
// the dashboard is constructed with it, so a future change that reintroduces a
// `designs` insert fails loudly in development instead of quietly shipping a
// regression.
//
// It inspects REQUEST bodies only, and only for the Supabase origin. Auth
// endpoints are exempt: `/auth/v1/*` legitimately carries JWTs, which look like
// long base64 to any heuristic, and carries no listing content.

import { assertNoImageBytes, assertNoListingContent, bodyForInspection } from "@teepublic/shared";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? "";
}

/** Auth traffic is exempt — see the module comment. */
function isExempt(url: string): boolean {
  return /\/auth\/v1\//.test(url);
}

export function createGuardedFetch(base: FetchFn = fetch): FetchFn {
  return async (input, init) => {
    const url = urlOf(input);
    if (!isExempt(url)) {
      // A Request object's body is a stream we cannot read without consuming
      // it; the Supabase clients always pass a string body via `init`, so this
      // covers every call they make.
      const payload = bodyForInspection(init?.body as unknown);
      if (payload !== undefined) {
        assertNoImageBytes(`Supabase request to ${url}`, payload);
        assertNoListingContent(`Supabase request to ${url}`, payload);
      }
    }
    return base(input, init);
  };
}

export const guardedFetch: FetchFn = createGuardedFetch();
