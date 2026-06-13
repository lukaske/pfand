import { NextResponse } from "next/server";
import { getActivity } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const activity = await getActivity();
  return NextResponse.json({ activity });
}
