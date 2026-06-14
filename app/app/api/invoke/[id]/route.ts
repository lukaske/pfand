import { NextResponse, type NextRequest } from "next/server";
import { ENGINES, invokeAgentEngine } from "@/lib/agent-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Free proxy to the Vertex AI Agent-Engine (ADK) agents registered on Arc 8004.
 * `id` is the engine slug ("deep-search" | "travel-concierge"). The Broker is
 * the only x402-charged surface; these agents are called for free.
 *   POST { "message": "..." }   or   GET ?q=...
 */
async function run(id: string, message: string) {
  const ref = ENGINES[id];
  if (!ref) {
    return NextResponse.json(
      { error: `unknown agent '${id}'`, available: Object.keys(ENGINES) },
      { status: 404 },
    );
  }
  if (!message.trim()) {
    return NextResponse.json({ error: "missing 'message'" }, { status: 400 });
  }
  try {
    const text = await invokeAgentEngine(ref, message);
    return NextResponse.json({ agent: ref.slug, name: ref.name, text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "invoke failed" },
      { status: 502 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  return run(id, body.message ?? "");
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return run(id, req.nextUrl.searchParams.get("q") ?? "");
}
