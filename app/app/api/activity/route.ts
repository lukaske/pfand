import { NextResponse } from "next/server";
import { ACTIVITY } from "@/lib/seed";

export async function GET() {
  return NextResponse.json({ activity: ACTIVITY });
}
