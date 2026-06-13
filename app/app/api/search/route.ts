import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/seed";
import { extractFilters, rankAgents } from "@/lib/search";

export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: string };
    query = (body.query ?? "").toString();
  } catch {
    // empty body → empty query
  }

  const filters = extractFilters(query);
  const results = rankAgents(AGENTS, filters);

  return NextResponse.json({ query, filters, results });
}
