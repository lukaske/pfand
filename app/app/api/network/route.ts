import { NextResponse, type NextRequest } from "next/server";
import type { NetworkNode, NetworkEdge, NetworkResponse } from "@/lib/api";
import { getAgents, getAllFeedback, getAllPayments, getUpdatedAt } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max agent bubbles to render (plus the single HUMAN root) — keeps the sim fast. */
const MAX_AGENT_NODES = 120;

/** The global HUMAN oracle / trust-root node id (mirrors engine's HUMAN). */
const HUMAN = "HUMAN";

/** Sign of a review: +1 vouch, −1 distrust, 0 neutral (magnitude ignored, mirrors engine). */
function reviewSign(fb: {
  isRevoked: boolean;
  tag2: string;
  value: number;
}): number {
  if (fb.isRevoked) return 0;
  if (fb.tag2 === "success") return 1;
  if (fb.tag2 === "fail") return -1;
  if (fb.value > 0) return 1;
  if (fb.value < 0) return -1;
  return 0;
}

export async function GET(req: NextRequest) {
  const task = req.nextUrl.searchParams.get("task");
  const [agents, feedback, payments, updatedAt] = await Promise.all([
    getAgents(),
    getAllFeedback(),
    getAllPayments(),
    getUpdatedAt(),
  ]);

  // Task categories present, by total tag frequency (for the filter chips).
  const vol = new Map<string, number>();
  for (const a of agents)
    for (const t of a.reputation.tags ?? [])
      vol.set(t.tag, (vol.get(t.tag) ?? 0) + t.count);
  const tasks = [...vol.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t);

  // --- node set: rated, NAMED agents (the constellation needs readable labels),
  // optionally restricted to a task category ---
  let rated = agents.filter((a) => a.reputation.trustRank != null && a.name);

  if (task) {
    rated = rated.filter((a) =>
      (a.reputation.tags ?? []).some((t) => t.tag === task),
    );
  }

  // Sort by raw eigenvector (bubble mass) and cap.
  rated.sort(
    (a, b) =>
      (b.reputation.trustRankRaw ?? 0) - (a.reputation.trustRankRaw ?? 0),
  );
  rated = rated.slice(0, MAX_AGENT_NODES);

  // HUMAN root node + the top rated agent nodes.
  const humanNode: NetworkNode = {
    id: HUMAN,
    kind: "human",
    agentId: "",
    network: null,
    name: "Human",
    ensName: null,
    trustRank: null,
    trustRankRaw: null,
    topTask: null,
  };

  const agentNodes: NetworkNode[] = rated.map((a) => ({
    id: `${a.network}:${a.agentId}`,
    kind: "agent",
    agentId: a.agentId,
    network: a.network,
    name: a.name,
    ensName: a.ensName,
    trustRank: a.reputation.trustRank ?? null,
    trustRankRaw: a.reputation.trustRankRaw ?? null,
    topTask: a.reputation.topTask ?? null,
    distrustFlag: a.reputation.distrustFlag ?? false,
    evidence: a.reputation.evidence,
  }));

  const nodes: NetworkNode[] = [humanNode, ...agentNodes];
  const nodeIds = new Set(nodes.map((n) => n.id)); // includes HUMAN

  // Source resolution: lowercased (owner | payToWallet) → agent node id, scoped
  // per network (mirrors the engine's addrToAgent map). A source that doesn't
  // map to a known agent node resolves to the HUMAN oracle.
  const addrToNode = new Map<string, string>();
  for (const a of rated) {
    const id = `${a.network}:${a.agentId}`;
    if (a.owner) addrToNode.set(`${a.network}:${a.owner.toLowerCase()}`, id);
    if (a.payToWallet)
      addrToNode.set(`${a.network}:${a.payToWallet.toLowerCase()}`, id);
  }

  // Aggregate edges by (source,target,kind), summing weight. Drop self/zero
  // edges and any edge whose target isn't a rendered agent node.
  const agg = new Map<string, NetworkEdge>();
  const addEdge = (
    source: string,
    target: string,
    weight: number,
    kind: "review" | "payment",
  ) => {
    if (weight <= 0) return;
    if (source === target) return; // drop self-edges
    if (!nodeIds.has(target)) return; // target must be a rendered node
    if (source !== HUMAN && !nodeIds.has(source)) return; // HUMAN always valid
    const key = `${kind}:${source}->${target}`;
    const existing = agg.get(key);
    if (existing) existing.weight += weight;
    else agg.set(key, { source, target, weight, kind });
  };

  // --- review edges: net-positive sign count from reviewer → agent ---
  // Accumulate net sign per (source,target) first, then emit edges whose net > 0
  // (mirrors the engine: a source only vouches when its net sign is positive).
  const reviewNet = new Map<string, { source: string; target: string; net: number }>();
  for (const fb of feedback) {
    if (fb.isRevoked) continue;
    if (task && fb.tag1 !== task) continue;

    const target = `${fb.network}:${fb.agentId}`;
    if (!nodeIds.has(target)) continue;

    const sign = reviewSign(fb);
    if (sign === 0) continue;

    const source =
      addrToNode.get(`${fb.network}:${fb.client.toLowerCase()}`) ?? HUMAN;
    if (source === target) continue;

    const key = `${source}->${target}`;
    const cur = reviewNet.get(key) ?? { source, target, net: 0 };
    cur.net += sign;
    reviewNet.set(key, cur);
  }
  for (const { source, target, net } of reviewNet.values()) {
    if (net > 0) addEdge(source, target, net, "review");
  }

  // --- payment edges: log1p(amount) from payer → agent ---
  for (const p of payments) {
    if (task) continue; // payment edges aren't task-scoped; hide under a task filter
    const target = `${p.network}:${p.toAgentId}`;
    if (!nodeIds.has(target)) continue;

    const source =
      addrToNode.get(`${p.network}:${p.from.toLowerCase()}`) ?? HUMAN;
    if (source === target) continue;

    const weight = Math.log1p(Math.max(0, p.amountUsdc));
    addEdge(source, target, weight, "payment");
  }

  const edges: NetworkEdge[] = [...agg.values()];

  const body: NetworkResponse = { nodes, edges, tasks, updatedAt };
  return NextResponse.json(body);
}
