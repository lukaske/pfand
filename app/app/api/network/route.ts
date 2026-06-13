import { NextResponse, type NextRequest } from "next/server";
import type { NetworkNode, NetworkEdge, NetworkResponse } from "@/lib/api";
import { getAgents, getAllFeedback, getUpdatedAt } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max bubbles to render — keeps the force sim performant. */
const MAX_NODES = 120;

/**
 * Edge weight = client satisfaction for a feedback, mirroring the engine's
 * `satisfaction()`: revoked / `fail` → 0, `success` → 1, else clamp(score/100).
 */
function satisfaction(fb: {
  isRevoked: boolean;
  tag2: string;
  score: number;
}): number {
  if (fb.isRevoked) return 0;
  if (fb.tag2 === "fail") return 0;
  if (fb.tag2 === "success") return 1;
  const v = fb.score / 100;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export async function GET(req: NextRequest) {
  const task = req.nextUrl.searchParams.get("task");
  const [agents, feedback, updatedAt] = await Promise.all([
    getAgents(),
    getAllFeedback(),
    getUpdatedAt(),
  ]);

  // Task categories present, by total feedback volume (for the filter chips).
  const vol = new Map<string, number>();
  for (const a of agents)
    for (const t of a.reputation.scoresByTask ?? [])
      vol.set(t.tag, (vol.get(t.tag) ?? 0) + t.count);
  const tasks = [...vol.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t);

  // --- nodes: rated agents, optionally restricted to a task category ---
  let rated = agents.filter((a) => a.reputation.trustRank != null);

  if (task) {
    rated = rated.filter((a) =>
      (a.reputation.scoresByTask ?? []).some((t) => t.tag === task),
    );
  }

  // Sort by per-task score when filtering, else by raw eigenvector.
  const taskScoreOf = (a: (typeof rated)[number]): number =>
    (a.reputation.scoresByTask ?? []).find((t) => t.tag === task)?.score ?? 0;

  rated.sort((a, b) =>
    task
      ? taskScoreOf(b) - taskScoreOf(a)
      : (b.reputation.trustRankRaw ?? 0) - (a.reputation.trustRankRaw ?? 0),
  );

  rated = rated.slice(0, MAX_NODES);

  const nodes: NetworkNode[] = rated.map((a) => ({
    id: `${a.network}:${a.agentId}`,
    agentId: a.agentId,
    network: a.network,
    name: a.name,
    ensName: a.ensName,
    trustRank: a.reputation.trustRank ?? null,
    trustRankRaw: a.reputation.trustRankRaw ?? null,
    topTask: a.reputation.topTask ?? null,
    taskScore: task ? taskScoreOf(a) : null,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));

  // --- edges: trust flow between agents present in the node set ---
  // lowercased (owner | payToWallet) address → node id, scoped per network.
  const addrToNode = new Map<string, string>();
  for (const a of rated) {
    const id = `${a.network}:${a.agentId}`;
    if (a.owner) addrToNode.set(`${a.network}:${a.owner.toLowerCase()}`, id);
    if (a.payToWallet)
      addrToNode.set(`${a.network}:${a.payToWallet.toLowerCase()}`, id);
  }

  // Aggregate duplicate (source,target) pairs by summing weight.
  const agg = new Map<string, NetworkEdge>();
  for (const fb of feedback) {
    if (fb.isRevoked) continue;
    if (task && fb.tag1 !== task) continue;

    const target = `${fb.network}:${fb.agentId}`;
    if (!nodeIds.has(target)) continue;

    const source = addrToNode.get(`${fb.network}:${fb.client.toLowerCase()}`);
    if (!source || !nodeIds.has(source)) continue;
    if (source === target) continue; // drop self-edges

    const weight = satisfaction(fb);
    if (weight <= 0) continue;

    const key = `${source}->${target}`;
    const existing = agg.get(key);
    if (existing) existing.weight += weight;
    else agg.set(key, { source, target, weight });
  }

  const edges: NetworkEdge[] = [...agg.values()];

  const body: NetworkResponse = { nodes, edges, tasks, updatedAt };
  return NextResponse.json(body);
}
