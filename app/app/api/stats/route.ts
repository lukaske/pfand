import { NextResponse } from "next/server";
import { STATS } from "@/lib/seed";

export async function GET() {
  return NextResponse.json(STATS);
}
