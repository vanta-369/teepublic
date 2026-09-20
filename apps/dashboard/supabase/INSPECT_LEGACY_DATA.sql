-- INSPECT_LEGACY_DATA.sql
-- READ-ONLY. Run this in the Supabase SQL Editor BEFORE deciding what to delete.
--
-- It answers four questions about what is currently stored in the project:
--   A. How many base64/data-URL images are sitting in `designs.image_url`, and
--      how much space do they take?
--   B. How many are hiding inside the `spreadsheet_batches.data` JSONB blob?
--   C. What detailed listing content (titles, descriptions, tags, filenames,
--      product configuration, earnings exports) is stored, and for whom?
--   D. How many per-upload event rows exist, and does the aggregate backfill in
--      migration 0009 match them?
--
-- Nothing here writes, updates or deletes. Every query is guarded with
-- to_regclass so it is safe to run on a project missing any of these tables.
--
-- The destructive counterpart is 0011_cleanup_legacy_data.sql, which is inert
-- until someone deliberately uncomments it.

\echo '=== A. Base64 images in public.designs.image_url ==='
do $$
begin
  if to_regclass('public.designs') is null then
    raise notice 'public.designs: not present';
  end if;
end;
$$;

select
  count(*)                                                       as design_rows,
  count(*) filter (where image_url like 'data:%')                as data_url_rows,
  count(*) filter (where image_url like 'http%')                 as remote_url_rows,
  count(*) filter (where coalesce(image_url, '') = '')           as empty_rows,
  count(distinct user_id)                                        as users_affected,
  pg_size_pretty(
    coalesce(sum(octet_length(image_url)) filter (where image_url like 'data:%'), 0)
  )                                                              as data_url_bytes,
  pg_size_pretty(coalesce(max(octet_length(image_url)), 0))      as largest_single_value
from public.designs;

-- Per-user breakdown, biggest first. Emails come from profiles so the owner can
-- tell people what was stored; no listing content is selected here.
select
  d.user_id,
  p.email,
  count(*)                                                       as designs,
  count(*) filter (where d.image_url like 'data:%')              as base64_images,
  pg_size_pretty(coalesce(sum(octet_length(d.image_url)), 0))    as image_url_bytes
from public.designs d
left join public.profiles p on p.id = d.user_id
group by d.user_id, p.email
order by sum(octet_length(d.image_url)) desc nulls last
limit 50;

-- A safe sample: the shape of the stored value, never the value itself.
select
  id,
  user_id,
  left(coalesce(image_url, ''), 40) as image_url_prefix,
  octet_length(image_url)           as bytes,
  updated_at
from public.designs
where image_url like 'data:%'
order by octet_length(image_url) desc
limit 10;

\echo '=== B. Base64 images inside public.spreadsheet_batches.data ==='
select
  count(*)                                                        as batch_rows,
  count(distinct user_id)                                         as users_affected,
  pg_size_pretty(coalesce(sum(octet_length(data::text)), 0))      as total_jsonb_bytes,
  count(*) filter (where data::text like '%data:image/%')         as rows_containing_data_urls
from public.spreadsheet_batches;

-- How many image entries each stored batch carries, and how many of those are
-- inline data URLs. `data -> 'images'` is the MatchedImage[] the old client saved.
select
  b.user_id,
  p.email,
  jsonb_array_length(coalesce(b.data -> 'images', '[]'::jsonb))   as image_entries,
  jsonb_array_length(coalesce(b.data -> 'rows', '[]'::jsonb))     as listing_rows,
  (
    select count(*)
    from jsonb_array_elements(coalesce(b.data -> 'images', '[]'::jsonb)) i
    where i ->> 'url' like 'data:%'
  )                                                               as inline_data_urls,
  pg_size_pretty(octet_length(b.data::text))                      as bytes,
  b.updated_at
from public.spreadsheet_batches b
left join public.profiles p on p.id = b.user_id
order by octet_length(b.data::text) desc
limit 50;

\echo '=== C. Detailed listing content stored server-side ==='

-- C1. Listing copy and product configuration on `designs`. Counts only - this
-- query deliberately does not print titles or descriptions.
select
  count(*)                                                        as design_rows,
  count(*) filter (where listing is not null)                     as rows_with_listing_copy,
  count(*) filter (where listing ? 'title')                       as rows_with_title,
  count(*) filter (where listing ? 'description')                 as rows_with_description,
  count(*) filter (where listing ? 'tags')                        as rows_with_tags,
  count(*) filter (where config is not null)                      as rows_with_product_config,
  count(*) filter (where coalesce(original_name, '') <> '')       as rows_with_filename,
  min(created_at)                                                 as oldest,
  max(updated_at)                                                 as newest
from public.designs;

-- C2. Earnings exports (raw CSV: design titles, product types, prices).
select
  count(*)                                                        as report_rows,
  count(distinct user_id)                                         as users_affected,
  sum(row_count)                                                  as total_export_rows,
  pg_size_pretty(coalesce(sum(octet_length(content)), 0))         as total_csv_bytes,
  min(uploaded_at)                                                as oldest,
  max(uploaded_at)                                                as newest
from public.sales_reports;

-- C3. Generation activity log. Older rows may carry an `imageId` in metadata
-- (a local design id); the client no longer sends one.
select
  action,
  count(*)                                                        as events,
  count(*) filter (where metadata ? 'imageId')                    as rows_with_image_id,
  count(*) filter (where metadata ? 'message')                    as rows_with_error_text,
  min(created_at)                                                 as oldest,
  max(created_at)                                                 as newest
from public.activity_logs
where action like 'generation.%'
group by action
order by events desc;

\echo '=== D. Per-upload events vs the new aggregate counter ==='
select
  count(*)                                                        as event_rows,
  count(distinct user_id)                                         as users_affected,
  count(*) filter (where listing_url is not null)                 as rows_with_listing_url,
  count(*) filter (where coalesce(title, '') <> '')               as rows_with_title,
  count(*) filter (where coalesce(design_id, '') <> '')           as rows_with_design_id,
  count(distinct platform)                                        as distinct_platforms,
  min(published_at)                                               as oldest,
  max(published_at)                                               as newest
from public.upload_events;

-- Reconciliation: every user's event count next to the counter migration 0009
-- wrote. `delta` should be 0 for every row before any cleanup is considered.
-- A positive delta means the counter moved after the backfill (new uploads),
-- which is expected and fine; a negative one means the backfill did not run.
select
  coalesce(e.user_id, s.user_id)                                  as user_id,
  p.email,
  coalesce(e.events, 0)                                           as events,
  coalesce(s.total_upload_count, 0)                               as counter,
  coalesce(s.total_upload_count, 0) - coalesce(e.events, 0)       as delta
from (
  select user_id, count(*)::bigint as events
  from public.upload_events
  group by user_id
) e
full join public.upload_stats s on s.user_id = e.user_id
left join public.profiles p on p.id = coalesce(e.user_id, s.user_id)
order by abs(coalesce(s.total_upload_count, 0) - coalesce(e.events, 0)) desc
limit 100;

\echo '=== E. Storage: objects in the public `designs` bucket ==='
select
  b.id                                                            as bucket,
  b.public                                                        as is_public,
  count(o.id)                                                     as objects,
  pg_size_pretty(
    coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  )                                                               as total_size,
  min(o.created_at)                                               as oldest,
  max(o.created_at)                                               as newest
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
where b.id = 'designs'
group by b.id, b.public;

-- The largest objects, by path. Paths are <sessionId>/<filename>, so a filename
-- is listing content - review these before sharing the output.
select
  name,
  (metadata ->> 'size')::bigint                                   as bytes,
  metadata ->> 'mimetype'                                         as mimetype,
  created_at
from storage.objects
where bucket_id = 'designs'
order by (metadata ->> 'size')::bigint desc nulls last
limit 25;
