// Gate the whole dashboard behind a valid Supabase session and refresh tokens
// on every request. The actual logic lives in lib/supabase/middleware.ts.
//
// The matcher excludes /api (the auth endpoints set/clear cookies themselves),
// Next internals, and static assets.
//
// "Static assets" has to mean FILES, not just /_next/static. Anything served
// from public/ — and the App Router metadata icon at /icon.png — sits at the
// site root, so without the extension exclusion below the gate 307s them to
// /signin and the browser gets an HTML redirect where it asked for an image.
// That is what left the tab favicon and the header mark broken.

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(req: NextRequest) {
  return await updateSession(req);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|.*[.](?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|otf)$).*)",
  ],
};
