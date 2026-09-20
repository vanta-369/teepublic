// The one upload statistic Higgstee keeps: a lifetime count of successful
// publishes, per account.
//
// WHAT THIS REPLACED: `public.upload_events`, one row per publish carrying the
// design id, the listing title, the published listing URL, the platform and a
// timestamp. That is a complete history of what a seller makes and where it
// went — none of which is needed to show someone how much they have uploaded.
// It is now a single integer per user (migration 0009), incremented by an
// RPC that derives the user from auth.uid() and is read back through RLS.
//
// The cost: the dashboard can no longer break the number down by day, week or
// month, because nothing server-side knows WHEN an upload happened beyond the
// last time the counter moved.

import { createClient } from "@/lib/supabase/client";

export interface UploadCountState {
  total: number;
  updatedAt: string | null;
}

/**
 * Read this user's aggregate count. RLS on `public.upload_stats` scopes the
 * read to auth.uid(), so there is no way to ask for someone else's number.
 */
export async function fetchUploadCount(): Promise<UploadCountState> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("upload_stats")
    .select("total_upload_count, updated_at")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { total: 0, updatedAt: null };

  return {
    total: Number(data.total_upload_count ?? 0),
    updatedAt: (data.updated_at as string | null) ?? null,
  };
}
