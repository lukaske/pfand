/**
 * Pfand TrustRank — a deterministic EigenTrust / PageRank engine over
 * ERC-8004 feedback signals.
 *
 * The core idea (Kamvar et al., "The EigenTrust Algorithm for Reputation
 * Management in P2P Networks"): trust flows along the graph of who-rated-whom.
 * An endorsement from a highly-trusted rater is worth more than an endorsement
 * from an anonymous wallet. Sybil wallets that rate others but are never rated
 * themselves carry (almost) no weight, because the prior trust mass sits on the
 * set of *rated* agents and only flows outward from there.
 *
 * This module is PURE: no I/O, no Date.now(), no global state. Callers pass a
 * `nowMs` for time decay. All randomness is removed so results are reproducible.
 */

import type { Agent, FeedbackEntry, AgentNetwork, TaskScore } from "./db";

export type { TaskScore };

/** Full per-agent trust result. Key in the returned Map = `${network}:${agentId}`. */
export interface TrustScore {
  agentId: string;
  network: AgentNetwork;
  /** 0–100 percentile among rated agents (pooled across networks), null if unrated. */
  trustRank: number | null;
  /** Raw eigenvector value (tiny), useful for bubble area; null if unrated. */
  trustRankRaw: number | null;
  /** Per-task 0–100 percentile scores, sorted desc by score. */
  scoresByTask: TaskScore[];
  /** Count of unique lowercased client addresses with non-revoked feedback. */
  distinctClients: number;
  /** Tag of the highest scoresByTask entry, or null. */
  topTask: string | null;
}

/** A directed trust edge: a rater (`from`) endorses an agent (`to`). */
export interface TrustEdge {
  /** Source node id: a `client:<addr>` leaf, or a `${network}:${agentId}` agent node. */
  from: string;
  /** Target node id: always an agent node `${network}:${agentId}`. */
  to: string;
  /** Aggregated edge weight = Σ satisfaction · decay · pfandBoost. */
  weight: number;
}

export interface TrustGraph {
  /** All node ids (agents + leaf clients) present in the graph. */
  nodes: string[];
  edges: TrustEdge[];
  /** Subset of `nodes` that are agent nodes (`${network}:${agentId}`). */
  agentNodes: Set<string>;
}

export interface ScoreOpts {
  /** Current time in ms for decay. Falsy (default 0) disables decay entirely. */
  nowMs?: number;
  /** Half-life in days for exponential time decay. Default 180. */
  halfLifeDays?: number;
  /** Multiplier applied to pfand-verified feedback. Default 3. */
  pfandBoost?: number;
  /** EigenTrust teleport / restart probability `a`. Default 0.15. */
  teleport?: number;
  /** Max power-iterations (stops early at L1 delta < 1e-9). Default 100. */
  iterations?: number;
  /** How many top task categories (by volume) to score per-task. Default 12. */
  maxTasks?: number;
}

interface ResolvedOpts {
  nowMs: number;
  halfLifeDays: number;
  pfandBoost: number;
  teleport: number;
  iterations: number;
  maxTasks: number;
}

function resolveOpts(opts?: ScoreOpts): ResolvedOpts {
  return {
    nowMs: opts?.nowMs ?? 0,
    halfLifeDays: opts?.halfLifeDays ?? 180,
    pfandBoost: opts?.pfandBoost ?? 3,
    teleport: opts?.teleport ?? 0.15,
    iterations: opts?.iterations ?? 100,
    maxTasks: opts?.maxTasks ?? 12,
  };
}

const DAY_MS = 86_400_000;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Node id for an agent in a given network. */
function agentNodeId(network: AgentNetwork, agentId: string): string {
  return `${network}:${agentId}`;
}

/** Is this feedback "pfand-verified" (and thus boosted)? */
function isPfandVerified(fb: FeedbackEntry): boolean {
  const t2 = fb.tag2;
  if (t2 === "pfand-demo" || t2 === "success" || t2 === "fail") return true;
  const t1l = fb.tag1.toLowerCase();
  const t2l = t2.toLowerCase();
  return t1l.includes("pfand") || t2l.includes("pfand");
}

/** Map a feedback to a [0,1] satisfaction value. Revoked → 0. */
function satisfaction(fb: FeedbackEntry): number {
  if (fb.isRevoked) return 0;
  if (fb.tag2 === "fail") return 0;
  if (fb.tag2 === "success") return 1;
  // `score` is already value / 10^decimals; most ratings live in 0–100.
  return clamp(fb.score / 100, 0, 1);
}

/** Exponential time-decay factor in [0,1]. 1 when decay is disabled. */
function decayFactor(fb: FeedbackEntry, o: ResolvedOpts): number {
  if (!o.nowMs || fb.timestamp == null) return 1;
  const t = Date.parse(fb.timestamp);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (o.nowMs - t) / DAY_MS);
  return Math.pow(0.5, ageDays / o.halfLifeDays);
}

/**
 * Build the trust graph for a single network's feedback.
 *
 * Edge source resolution: a feedback's `client` address is lowercased and
 * looked up against the (owner | payToWallet) → agentNode map. If it maps to a
 * known agent, the edge flows agent→agent (real trust propagation). Otherwise
 * the source is a leaf `client:<addr>` node that can give trust but never
 * receives any.
 */
function buildGraphForNetwork(
  feedback: FeedbackEntry[],
  agents: Agent[],
  o: ResolvedOpts,
): TrustGraph {
  const agentNodes = new Set<string>();
  // lowercased address (owner / payToWallet) -> agent node id
  const addrToAgent = new Map<string, string>();

  for (const a of agents) {
    const node = agentNodeId(a.network, a.agentId);
    agentNodes.add(node);
    if (a.owner) addrToAgent.set(a.owner.toLowerCase(), node);
    if (a.payToWallet) addrToAgent.set(a.payToWallet.toLowerCase(), node);
  }

  // Aggregate edge weights per (source, targetAgent).
  const edgeWeights = new Map<string, number>(); // `${from} ${to}` -> weight
  const nodes = new Set<string>(agentNodes);

  for (const fb of feedback) {
    const target = agentNodeId(fb.network, fb.agentId);
    agentNodes.add(target);
    nodes.add(target);

    const w =
      satisfaction(fb) * decayFactor(fb, o) * (isPfandVerified(fb) ? o.pfandBoost : 1);
    if (w <= 0) continue;

    const clientLc = fb.client.toLowerCase();
    const mapped = addrToAgent.get(clientLc);
    // A self-rating (mapped === target) would create a self-loop that just
    // pumps an agent's own score — skip those.
    const from = mapped && mapped !== target ? mapped : `client:${clientLc}`;
    if (from === target) continue;

    nodes.add(from);
    const key = `${from} ${target}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + w);
  }

  const edges: TrustEdge[] = [];
  for (const [key, weight] of edgeWeights) {
    const sep = key.indexOf(" ");
    edges.push({ from: key.slice(0, sep), to: key.slice(sep + 1), weight });
  }

  return { nodes: [...nodes], edges, agentNodes };
}

/**
 * Public graph builder. Merges per-network graphs into one structure (nodes are
 * namespaced by network so they never collide). Callers usually let
 * `scoreAgents` partition for them, but this is exposed for inspection/tests.
 */
export function buildTrustGraph(
  feedback: FeedbackEntry[],
  agents: Agent[],
  opts?: ScoreOpts,
): TrustGraph {
  const o = resolveOpts(opts);
  const networks: AgentNetwork[] = ["mainnet", "arc"];
  const nodes = new Set<string>();
  const edges: TrustEdge[] = [];
  const agentNodes = new Set<string>();

  for (const net of networks) {
    const g = buildGraphForNetwork(
      feedback.filter((f) => f.network === net),
      agents.filter((a) => a.network === net),
      o,
    );
    for (const n of g.nodes) nodes.add(n);
    for (const e of g.edges) edges.push(e);
    for (const a of g.agentNodes) agentNodes.add(a);
  }

  return { nodes: [...nodes], edges, agentNodes };
}

/**
 * Run EigenTrust power-iteration on a single graph.
 *
 *   t ← (1-a)·Cᵀ·t + a·p
 *
 * where C is the row-stochastic local-trust matrix, `a` is the teleport, and
 * the prior `p` is uniform over agent nodes that have ≥1 incoming edge ("rated"
 * agents). Leaf clients keep prior 0 and are never ranked. Returns node → raw
 * eigenvector value. This is the merged-graph version: it runs each network's
 * connected component implicitly (edges never cross networks), which is
 * equivalent to running them separately and concatenating the vectors.
 */
export function computeEigenTrust(
  graph: TrustGraph,
  opts?: ScoreOpts,
): Map<string, number> {
  const o = resolveOpts(opts);
  const a = o.teleport;

  // Row-normalize outgoing weights per source → local trust matrix C.
  // We store C as: for each source, a list of {to, c} with Σ c = 1.
  const outBySource = new Map<string, { to: string; c: number }[]>();
  const rowTotal = new Map<string, number>();
  for (const e of graph.edges) {
    rowTotal.set(e.from, (rowTotal.get(e.from) ?? 0) + e.weight);
  }
  for (const e of graph.edges) {
    const total = rowTotal.get(e.from)!;
    if (total <= 0) continue;
    const list = outBySource.get(e.from) ?? [];
    list.push({ to: e.to, c: e.weight / total });
    outBySource.set(e.from, list);
  }

  // "Rated" agents = agent nodes with ≥1 incoming edge.
  const incoming = new Set<string>();
  for (const e of graph.edges) incoming.add(e.to);
  const rated = [...graph.agentNodes].filter((n) => incoming.has(n));

  const result = new Map<string, number>();
  if (rated.length === 0) return result;

  // Prior p: uniform over rated agents.
  const prior = new Map<string, number>();
  const pVal = 1 / rated.length;
  for (const n of rated) prior.set(n, pVal);

  // Start t = p. Only nodes that ever hold mass need entries.
  let t = new Map<string, number>(prior);

  for (let iter = 0; iter < o.iterations; iter++) {
    // next = (1-a) · Cᵀ·t  +  a · p
    const next = new Map<string, number>();
    // teleport term
    for (const [n, pv] of prior) next.set(n, a * pv);
    // propagation term: push each source's mass along its normalized edges
    for (const [src, mass] of t) {
      if (mass === 0) continue;
      const outs = outBySource.get(src);
      if (!outs) continue; // dangling node: its mass evaporates (handled by teleport)
      const factor = (1 - a) * mass;
      for (const { to: dst, c } of outs) {
        next.set(dst, (next.get(dst) ?? 0) + factor * c);
      }
    }

    // L1 convergence check.
    let delta = 0;
    const keys = new Set<string>([...t.keys(), ...next.keys()]);
    for (const k of keys) {
      delta += Math.abs((next.get(k) ?? 0) - (t.get(k) ?? 0));
    }
    t = next;
    if (delta < 1e-9) break;
  }

  // Only return agent nodes' values (clients are not ranked).
  for (const n of graph.agentNodes) {
    if (incoming.has(n)) result.set(n, t.get(n) ?? 0);
  }
  return result;
}

/**
 * Percentile rank (0–100) of `x` within `sorted` (ascending array of values).
 *   pct = (#values < x) / (n - 1) · 100
 * Single-value edge case → 100 (a lone rated agent is the best by default).
 */
function percentile(x: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n <= 1) return 100;
  // count strictly-less via binary search lower bound
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  const less = lo;
  return (less / (n - 1)) * 100;
}

/**
 * Score every agent. Returns Map keyed by `${network}:${agentId}`.
 *
 * Pipeline (run independently per network, then merged for display ranking):
 *   1. Build the trust graph.
 *   2. Run global EigenTrust → raw eigenvector per rated agent.
 *   3. Per-task: take the top `maxTasks` tag1 categories by volume; for each,
 *      rebuild + run EigenTrust on only that task's feedback and percentile the
 *      raws within agents rated in that task.
 *   4. Display: percentile each agent's global raw among ALL rated agents
 *      pooled across both networks → `trustRank`.
 */
export function scoreAgents(
  feedback: FeedbackEntry[],
  agents: Agent[],
  opts?: ScoreOpts,
): Map<string, TrustScore> {
  const o = resolveOpts(opts);
  const networks: AgentNetwork[] = ["mainnet", "arc"];

  // Raw global eigenvector per agent node, pooled across networks.
  const rawByAgent = new Map<string, number>();
  // Per-task percentile scores per agent node.
  const taskScoresByAgent = new Map<string, TaskScore[]>();
  // distinct non-revoked clients per agent node.
  const distinctClients = new Map<string, Set<string>>();
  // Every agent node we know about (so unrated agents still get an entry).
  const allAgentNodes = new Map<string, Agent>();

  for (const a of agents) {
    allAgentNodes.set(agentNodeId(a.network, a.agentId), a);
  }
  // Agents referenced only by feedback (not in `agents`) still get a node.
  for (const fb of feedback) {
    const node = agentNodeId(fb.network, fb.agentId);
    if (!allAgentNodes.has(node)) {
      allAgentNodes.set(node, {
        agentId: fb.agentId,
        network: fb.network,
      } as Agent);
    }
    if (!fb.isRevoked) {
      const set = distinctClients.get(node) ?? new Set<string>();
      set.add(fb.client.toLowerCase());
      distinctClients.set(node, set);
    }
  }

  for (const net of networks) {
    const netFeedback = feedback.filter((f) => f.network === net);
    const netAgents = agents.filter((a) => a.network === net);
    if (netFeedback.length === 0 && netAgents.length === 0) continue;

    // --- global ---
    const graph = buildGraphForNetwork(netFeedback, netAgents, o);
    const raw = computeEigenTrust(graph, o);
    for (const [node, v] of raw) rawByAgent.set(node, v);

    // --- per-task ---
    // Rank tag1 categories by feedback volume (ignore empty tag1).
    const volume = new Map<string, number>();
    for (const fb of netFeedback) {
      if (!fb.tag1) continue;
      volume.set(fb.tag1, (volume.get(fb.tag1) ?? 0) + 1);
    }
    const topTasks = [...volume.entries()]
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)) // volume desc, tag asc tiebreak
      .slice(0, o.maxTasks)
      .map(([tag]) => tag);

    for (const task of topTasks) {
      const taskFb = netFeedback.filter((f) => f.tag1 === task);
      const taskGraph = buildGraphForNetwork(taskFb, netAgents, o);
      const taskRaw = computeEigenTrust(taskGraph, o);
      if (taskRaw.size === 0) continue;

      const sortedAsc = [...taskRaw.values()].sort((p, q) => p - q);
      const count = new Map<string, number>();
      for (const f of taskFb) {
        if (f.isRevoked) continue;
        const node = agentNodeId(f.network, f.agentId);
        count.set(node, (count.get(node) ?? 0) + 1);
      }
      for (const [node, v] of taskRaw) {
        const list = taskScoresByAgent.get(node) ?? [];
        list.push({
          tag: task,
          score: percentile(v, sortedAsc),
          count: count.get(node) ?? 0,
        });
        taskScoresByAgent.set(node, list);
      }
    }
  }

  // --- display normalization: percentile global raws across BOTH networks ---
  const allRaws = [...rawByAgent.values()].sort((p, q) => p - q);

  const out = new Map<string, TrustScore>();
  for (const [node, agent] of allAgentNodes) {
    const raw = rawByAgent.get(node);
    const clients = distinctClients.get(node)?.size ?? 0;

    if (raw === undefined) {
      // Unrated: no incoming feedback.
      out.set(node, {
        agentId: agent.agentId,
        network: agent.network,
        trustRank: null,
        trustRankRaw: null,
        scoresByTask: [],
        distinctClients: clients,
        topTask: null,
      });
      continue;
    }

    const tasks = (taskScoresByAgent.get(node) ?? [])
      .slice()
      .sort((x, y) => y.score - x.score || (x.tag < y.tag ? -1 : 1));

    out.set(node, {
      agentId: agent.agentId,
      network: agent.network,
      trustRank: percentile(raw, allRaws),
      trustRankRaw: raw,
      scoresByTask: tasks,
      distinctClients: clients,
      topTask: tasks.length > 0 ? tasks[0]!.tag : null,
    });
  }

  return out;
}
