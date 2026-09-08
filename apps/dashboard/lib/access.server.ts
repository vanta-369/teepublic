import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import type { AccessState } from "@teepublic/shared";

// Request-memoized access lookup. A layout and its page render in the SAME
// server request, so wrapping get_my_access() in React cache() collapses their
// duplicate RPCs into a single round-trip per navigation. Use this in server
// components instead of calling getAccess() directly.
export const getMyAccess = cache(async (): Promise<AccessState | null> => {
  const supabase = await createClient();
  return getAccess(supabase);
});
