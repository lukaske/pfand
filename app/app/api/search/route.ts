import { NextResponse } from "next/server";
import { broker } from "@/lib/broker";

// Vertex AI SDK + EigenTrust scoring run server-side only.
export const runtime = "nodejs";

export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: string };
    query = (body.query ?? "").toString();
  } catch {
    // empty body → empty query
  }

  const response = await broker(query);
  return NextResponse.json(response);
}
