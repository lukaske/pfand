/**
 * /api/cron/embeddings — backfill Vertex embeddings for the served corpus.
 *
 * Embeds (Vertex `text-embedding-004`, 256-dim) every served agent (rated mainnet
 * + all Arc) that still lacks an `embedding`, in bounded batches, and writes them
 * to the pgvector column so semantic search (broker) works. Idempotent: each call
 * processes up to `?limit` (default 200) still-missing rows, so loop until
 * `remaining === 0`. Same auth as the recompute cron.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://pfand.vercel.app/api/cron/embeddings?limit=200"
 */
import { NextResponse, type NextRequest } from "next/server";
import { agentsMissingEmbedding, setAgentEmbedding } from "@/lib/db";
import { embedTexts, agentEmbedText } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const limit = Math.min(
      500,
      Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 200),
    );
    const todo = await agentsMissingEmbedding(limit);
    if (todo.length === 0) {
      return NextResponse.json({ ok: true, embedded: 0, remaining: 0, done: true });
    }
    const vectors = await embedTexts(
      todo.map((a) => agentEmbedText(a)),
      "RETRIEVAL_DOCUMENT",
    );
    let embedded = 0;
    for (let i = 0; i < todo.length; i++) {
      const vec = vectors[i];
      if (!vec) continue;
      await setAgentEmbedding(todo[i]!.network, todo[i]!.agentId, vec);
      embedded++;
    }
    // If we filled a full page, there may be more.
    const remaining = todo.length === limit ? "more" : 0;
    return NextResponse.json({
      ok: true,
      embedded,
      attempted: todo.length,
      remaining,
      done: remaining === 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/embeddings] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
