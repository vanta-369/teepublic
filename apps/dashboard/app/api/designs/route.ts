// Per-user persistence for AI-generated designs.
//   GET    /api/designs            -> list the caller's designs
//   POST   /api/designs { designs } -> upsert a batch of the caller's designs
//   DELETE /api/designs?id=<id>     -> delete one of the caller's designs
//
// All handlers use the session (anon) client, so Supabase RLS scopes every
// query to auth.uid() — a user can only ever touch their own rows.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/access";
import type { PersistedDesign } from "@/lib/designsStore";

export const runtime = "nodejs";

const TABLE = "designs";

function rowToDesign(r: Record<string, unknown>): PersistedDesign {
  return {
    id: String(r.id),
    sessionId: (r.session_id as string) ?? "",
    imageUrl: (r.image_url as string) ?? "",
    serverFilename: (r.server_filename as string) ?? "",
    originalName: (r.original_name as string) ?? "",
    mime: (r.mime as string) ?? "image/png",
    size: Number(r.size ?? 0),
    listing: (r.listing as PersistedDesign["listing"]) ?? null,
    config: r.config as PersistedDesign["config"],
    status: (r.status as string) ?? "ready",
  };
}

export async function GET() {
  // Reads are allowed in "limited" (expired) mode so users keep read-only access
  // to their own history — RLS already scopes rows to auth.uid(). Only mutating
  // routes below require active access.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, designs: (data ?? []).map(rowToDesign) });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  // Writing designs is a paid/trial feature — resolve access LIVE from the DB.
  const gate = await requireAccess(supabase);
  if ("response" in gate) return gate.response;
  const user = { id: gate.access.user_id };

  let body: { designs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(body.designs)) {
    return NextResponse.json({ ok: false, error: "Expected { designs: [...] }." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = (body.designs as PersistedDesign[]).map((d) => ({
    id: d.id,
    user_id: user.id,
    session_id: d.sessionId ?? null,
    image_url: d.imageUrl,
    server_filename: d.serverFilename ?? null,
    original_name: d.originalName ?? null,
    mime: d.mime ?? null,
    size: d.size ?? null,
    listing: d.listing ?? null,
    config: d.config ?? null,
    status: d.status ?? null,
    updated_at: now,
  }));

  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "user_id,id" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Authoritative sync: drop any of the user's designs that aren't in this set,
  // so removing a design locally + Import deletes it server-side too.
  const keepIds = rows.map((r) => r.id);
  let del = supabase.from(TABLE).delete().eq("user_id", user.id);
  if (keepIds.length > 0) {
    del = del.not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);
  }
  const { error: delError } = await del;
  if (delError) return NextResponse.json({ ok: false, error: delError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const gate = await requireAccess(supabase);
  if ("response" in gate) return gate.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
