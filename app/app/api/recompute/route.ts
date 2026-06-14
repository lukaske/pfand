/**
 * POST /api/recompute — public, password-gated BigQuery re-index trigger.
 *
 * Body: { "password": "querypls" }. Runs the full mainnet ERC-8004 re-scan
 * (BigQuery → Supabase → TrustRank). Heavy + costs BigQuery, so it's behind a
 * shared password rather than fully open.
 */
import { NextResponse, type NextRequest } from "next/server";
import { recompute } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PASSWORD = "querypls";

export async function POST(req: NextRequest) {
  let password = "";
  try {
    password = ((await req.json()) as { password?: string })?.password ?? "";
  } catch {
    /* no/!json body */
  }
  if (password !== PASSWORD) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  try {
    const summary = await recompute();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
