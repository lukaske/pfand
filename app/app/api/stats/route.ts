import { NextResponse } from "next/server";
import { getStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getStats();
  return NextResponse.json(stats);
}
