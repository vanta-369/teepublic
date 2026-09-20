// The ONE upload statistic Higgstee keeps server-side: how many listings this
// account has successfully published, in total. No design id, no title, no
// listing URL, no per-upload history — see supabase/migrations/0009.
export interface UploadCount {
  /** auth.uid() of the owner. */
  user_id: string;
  /** Lifetime count of confirmed successful publishes. */
  total_upload_count: number;
  /** When the counter last moved. */
  updated_at: string;
}
