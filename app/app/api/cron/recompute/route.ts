/**
 * /api/cron/recompute — self-refreshing TrustRank job.
 *
 * Triggered by Vercel Cron (see app/vercel.json) every 3 hours, or manually.
 * Re-scans the mainnet ERC-8004 registries from BigQuery, upserts into Supabase,
 * runs the EigenTrust engine, and writes fresh TrustRank + trustrank_updated_at.
 *
 * Auth: either `Authorization: Bearer ${CRON_SECRET}` OR Vercel's own cron header
 * (`x-vercel-cron`). When neither CRON_SECRET nor the Vercel header is present we
 * still allow the call but rely on recompute()'s graceful no-op for safety.
 *
 * Returns the recompute summary JSON. No-ops (skipped:true) without GCP/Supabase.
 */
import { NextResponse, type NextRequest } from "next/server";
import { recompute } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow a long-running scan (Vercel caps depend on plan; recompute is bounded).
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  // Vercel sets this header on cron-invoked requests.
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured → don't hard-block (no-op guards data)
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await recompute();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/recompute] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
