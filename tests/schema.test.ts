// What the database is allowed to hold, asserted against the migration files.
//
// HONEST SCOPE. These read the SQL that ships; they do not connect to Postgres.
// They can prove that the shipped schema declares the right columns, policies
// and function properties, and that no migration reintroduces a column the
// Privacy Policy says does not exist. They CANNOT prove that a given Supabase
// project has had them applied, or exercise RLS against a live server — that is
// listed under remaining risks, with the manual check to run.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

declare const __REPO_ROOT__: string;
const ROOT = __REPO_ROOT__;
const MIGRATIONS = path.join(ROOT, "apps/dashboard/supabase/migrations");

function sql(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), "utf8");
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const UPLOAD_STATS = sql("0009_upload_stats.sql");
const LOCKDOWN = sql("0010_lock_legacy_writes.sql");
const CLEANUP = sql("0011_cleanup_legacy_data.sql");

/** Strip comments so an assertion is about executable SQL, not prose. */
function executable(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

// ── The aggregate counter table ─────────────────────────────────────────────

test("upload_stats declares exactly the three permitted columns", () => {
  const body = /create table if not exists public\.upload_stats \(([\s\S]*?)\n\);/.exec(
    UPLOAD_STATS,
  )?.[1];
  assert.ok(body, "table definition not found");

  const columns = executable(body)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("constraint"))
    .map((l) => l.split(/\s+/)[0]);

  assert.deepEqual(columns, ["user_id", "total_upload_count", "updated_at"]);
});

test("upload_stats holds none of the forbidden upload details", () => {
  const forbidden = [
    "design_id",
    "listing_url",
    "title",
    "filename",
    "description",
    "tags",
    "image",
    "platform",
    "published_at",
  ];
  const def = /create table if not exists public\.upload_stats \(([\s\S]*?)\n\);/.exec(
    UPLOAD_STATS,
  )![1];
  for (const col of forbidden) {
    assert.ok(!new RegExp(`\\b${col}\\b`).test(def), `upload_stats declares "${col}"`);
  }
});

// ── Row Level Security ──────────────────────────────────────────────────────

test("upload_stats has RLS on, and users may only SELECT their own row", () => {
  assert.match(UPLOAD_STATS, /alter table public\.upload_stats enable row level security/);

  const policies = [...UPLOAD_STATS.matchAll(/create policy\s+"([^"]+)"\s+on public\.upload_stats\s+for\s+(\w+)/g)];
  assert.equal(policies.length, 1, "exactly one policy");
  assert.equal(policies[0][2], "select");
  assert.match(UPLOAD_STATS, /using \(\(select auth\.uid\(\)\) = user_id\)/);
});

test("no user-facing write policy exists on upload_stats", () => {
  for (const verb of ["insert", "update", "delete"]) {
    assert.ok(
      !new RegExp(`on public\\.upload_stats for ${verb}`).test(UPLOAD_STATS),
      `a ${verb} policy would let a user edit their own count`,
    );
  }
});

// ── The increment RPC ───────────────────────────────────────────────────────

test("increment_upload_count takes no arguments and derives the user server-side", () => {
  const fn = /create or replace function public\.increment_upload_count\(\)([\s\S]*?)\n\$\$;/.exec(
    UPLOAD_STATS,
  );
  assert.ok(fn, "function not found, or it takes parameters");

  const body = fn[1];
  assert.match(body, /security definer/, "must be able to write a table with no write policy");
  assert.match(body, /set search_path = public/, "definer rights must be pinned to a schema");
  assert.match(body, /uid\s+uuid\s*:=\s*auth\.uid\(\)/, "the user comes from auth.uid()");
  assert.match(body, /if uid is null then\s*\n\s*raise exception/, "anonymous callers are rejected");
  // A single atomic statement, so concurrent calls cannot lose an increment.
  assert.match(body, /on conflict \(user_id\) do update/);
  assert.match(body, /total_upload_count = s\.total_upload_count \+ 1/, "the delta is fixed at 1");
});

test("execute on increment_upload_count is granted only to authenticated users", () => {
  assert.match(UPLOAD_STATS, /revoke all on function public\.increment_upload_count\(\) from public/);
  assert.match(UPLOAD_STATS, /grant execute on function public\.increment_upload_count\(\) to authenticated/);
});

test("the read RPC runs as the caller, so RLS applies", () => {
  const fn = /create or replace function public\.get_my_upload_count\(\)([\s\S]*?)\$\$;/.exec(
    UPLOAD_STATS,
  );
  assert.ok(fn);
  assert.match(fn[1], /security invoker/);
  assert.match(fn[1], /where user_id = auth\.uid\(\)/);
});

// ── Migration from the old event log ────────────────────────────────────────

test("0009 backfills from upload_events without modifying it", () => {
  assert.match(UPLOAD_STATS, /from public\.upload_events\s*\n\s*group by user_id/);
  const exec = executable(UPLOAD_STATS);
  for (const destructive of [
    /delete from public\.upload_events/,
    /drop table[^\n]*upload_events/,
    /truncate[^\n]*upload_events/,
    /update public\.upload_events/,
  ]) {
    assert.ok(!destructive.test(exec), `0009 must not run ${destructive}`);
  }
});

test("0009 retires the time-bucketed stats RPC", () => {
  assert.match(UPLOAD_STATS, /drop function if exists public\.get_upload_stats\(text\)/);
});

// ── Lockdown ────────────────────────────────────────────────────────────────

test("0010 revokes write policies on every legacy table", () => {
  for (const policy of [
    "designs_insert_own",
    "designs_update_own",
    "spreadsheet_insert_own",
    "spreadsheet_update_own",
    "sales_reports_insert_own",
    "sales_reports_update_own",
    "upload_events_insert_own",
  ]) {
    assert.ok(LOCKDOWN.includes(policy), `0010 does not revoke ${policy}`);
  }
});

test("0010 revokes the browser's write access to the public designs bucket", () => {
  assert.match(LOCKDOWN, /drop policy if exists "designs_objects_insert_authenticated" on storage\.objects/);
  assert.match(LOCKDOWN, /drop policy if exists "designs_objects_update_authenticated" on storage\.objects/);
});

test("0010 deletes nothing", () => {
  const exec = executable(LOCKDOWN);
  for (const destructive of [/\bdelete from\b/i, /\bdrop table\b/i, /\btruncate\b/i]) {
    assert.ok(!destructive.test(exec), `0010 contains ${destructive}`);
  }
  // The bucket flip is documented but not executed.
  assert.ok(
    !/^\s*update storage\.buckets/m.test(exec),
    "flipping the bucket private must stay a documented step, not an executed one",
  );
});

// ── Cleanup is inert until approved ─────────────────────────────────────────

test("0011 is inert: no destructive statement is uncommented", () => {
  const exec = executable(CLEANUP);
  for (const destructive of [
    /\bdelete from\b/i,
    /\bdrop table\b/i,
    /\btruncate\b/i,
    /\bupdate public\./i,
    /\bupdate storage\./i,
  ]) {
    assert.ok(!destructive.test(exec), `0011 would execute ${destructive} - it must stay commented`);
  }
  assert.match(exec, /raise notice/, "0011 should announce that it did nothing");
});

// ── No migration reintroduces what was removed ──────────────────────────────

test("no migration after 0008 creates a table holding listing content", () => {
  for (const f of files.filter((n) => n.localeCompare("0008") > 0 && !n.startsWith("0008"))) {
    const exec = executable(sql(f));
    const creates = [...exec.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    for (const table of creates) {
      assert.equal(table, "upload_stats", `${f} creates unexpected table "${table}"`);
    }
  }
});
