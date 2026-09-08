// Per-user persistence for the "From spreadsheet" tab (one batch per user).
//   GET   /api/spreadsheet           -> the caller's saved batch (or null)
//   POST  /api/spreadsheet { batch } -> upsert the caller's batch
//
// Uses the session (anon) client, so Supabase RLS scopes every query to
// auth.uid() — a user can only ever touch their own row.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/access";
import type { SpreadsheetBatch } from "@/lib/spreadsheetStore";

export const runtime = "nodejs";

const TABLE = "spreadsheet_batches";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, batch: (data?.data as SpreadsheetBatch) ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  // Saving a spreadsheet batch is a paid/trial feature — resolve access live.
  const gate = await requireAccess(supabase);
  if ("response" in gate) return gate.response;
  const user = { id: gate.access.user_id };

  let body: { batch?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!body.batch || typeof body.batch !== "object") {
    return NextResponse.json({ ok: false, error: "Expected { batch: {...} }." }, { status: 400 });
  }

  const { error } = await supabase.from(TABLE).upsert(
    { user_id: user.id, data: body.batch, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
