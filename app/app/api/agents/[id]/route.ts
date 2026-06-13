import { NextResponse } from "next/server";
import { getAgent, getFeedback } from "@/lib/seed";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json({ agent, feedback: getFeedback(id) });
}
