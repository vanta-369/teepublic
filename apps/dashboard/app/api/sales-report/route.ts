// The user's stored TeePublic earnings export.
//   GET    /api/sales-report  -> the current report, or null
//   POST   /api/sales-report  -> replace it  { filename, content, rowCount }
//   DELETE /api/sales-report  -> clear it
//
// Uses the session (anon) client throughout, so Supabase RLS scopes every query
// to auth.uid() — a user can only ever touch their own report.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TABLE = "sales_reports";

/**
 * Cap on the stored file. The row lives in Postgres, and an earnings export is
 * a few hundred KB even for a busy shop — 8 MB is far above any real export
 * while still refusing a mis-picked file (a video, a database dump) before it
 * reaches the database.
 */
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Reads stay available in the expired/"limited" state, matching /api/designs.
  const { data, error } = await supabase
    .from(TABLE)
    .select("filename, content, row_count, uploaded_at")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: true, report: null });

  return NextResponse.json({
    ok: true,
    report: {
      filename: data.filename as string,
      content: data.content as string,
      rowCount: Number(data.row_count ?? 0),
      uploadedAt: data.uploaded_at as string,
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename.slice(0, 300) : null;
  const content = typeof body?.content === "string" ? body.content : null;
  const rowCount = Number.isFinite(body?.rowCount) ? Math.max(0, Math.trunc(body.rowCount)) : 0;

  if (!filename || !content) {
    return NextResponse.json(
      { ok: false, error: "filename and content are required." },
      { status: 400 },
    );
  }
  // Byte length, not string length — a UTF-8 export with accented design titles
  // is bigger on the wire than its character count suggests.
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That file is too large to save (8 MB limit)." },
      { status: 413 },
    );
  }

  // One row per user, so this replaces rather than accumulates.
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: user.id,
      filename,
      content,
      row_count: rowCount,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { error } = await supabase.from(TABLE).delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
