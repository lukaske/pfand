/**
 * POST /api/recompute — public, password-gated BigQuery re-index trigger.
 *
 * Body: { "password": "querypls" }. Runs the full mainnet ERC-8004 re-scan
 * (BigQuery → Supabase → TrustRank).
 *
 * SECURITY NOTE: the password is an intentional, low-security demo gate (it is
 * public in this repo). Because BigQuery costs money, this route is additionally
 * protected against abuse by a single-flight lock + a cooldown so it cannot be
 * stacked to drain GCP credits. For real auth move the secret to an env var and
 * require a Bearer header (see the team notes).
 */
import { NextResponse, type NextRequest } from "next/server";
import { recompute } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PASSWORD = "querypls";
const COOLDOWN_MS = 60_000;

// Per-instance guards. Not bulletproof across serverless cold starts, but caps
// the realistic abuse (rapid repeated clicks / casual hammering of the endpoint).
let inFlight = false;
let lastRunAt = 0;

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
  if (inFlight) {
    return NextResponse.json(
      { ok: false, error: "a re-index is already running" },
      { status: 429 },
    );
  }
  const since = Date.now() - lastRunAt;
  if (since < COOLDOWN_MS) {
    return NextResponse.json(
      { ok: false, error: `cooling down — try again in ${Math.ceil((COOLDOWN_MS - since) / 1000)}s` },
      { status: 429 },
    );
  }

  inFlight = true;
  try {
    const summary = await recompute();
    lastRunAt = Date.now();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    // Log the detail server-side; return a generic message to the client.
    console.error("[api/recompute] failed:", err);
    return NextResponse.json({ ok: false, error: "recompute failed" }, { status: 500 });
  } finally {
    inFlight = false;
  }
}
