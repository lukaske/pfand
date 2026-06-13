/**
 * recompute.ts — TrustRank recompute pass for the indexer.
 *
 * Loads ALL feedback + agents (from Supabase if configured, else falls back to
 * the BigQuery pull), runs the real EigenTrust engine (`scoreAgents` from
 * @pfand/shared), and upserts the per-agent TrustRank back into Supabase.
 *
 * This is the cheap "re-score without re-scanning the chain" path: it reads the
 * already-indexed feedback rows out of Postgres and recomputes the graph. The
 * full chain scan lives in bigquery.ts (which now also calls scoreAgents inline).
 *
 * Usage:
 *   tsx src/recompute.ts            # reads Supabase, recomputes, writes back
 *
 * No-op (returns {skipped:true}) when Supabase creds are missing.
 */
import { config as loadEnv } from "dotenv";
import {
  scoreAgents,
  type Agent,
  type FeedbackEntry,
  type AgentNetwork,
} from "@pfand/shared";

loadEnv();

export interface RecomputeSummary {
  skipped?: boolean;
  reason?: string;
  agentsScored?: number;
  feedbackConsidered?: number;
  ratedAgents?: number;
  updatedAt?: string;
}

interface AgentRow {
  network: string;
  agent_id: string;
}
interface FeedbackRow {
  network: string;
  agent_id: string;
  client: string;
  feedback_index: number | string;
  value: number | string;
  value_decimals: number | string;
  score: number | string;
  tag1: string | null;
  tag2: string | null;
  is_revoked: boolean | null;
  block_number: number | string | null;
  timestamp: string | null;
}

function hasSupabase(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
  );
}

/** Read every agent (network+id is enough — scoreAgents only needs the node set). */
async function loadAgents(client: {
  from: (t: string) => any;
}): Promise<Agent[]> {
  const out: Agent[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("agents")
      .select("network,agent_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load agents: ${error.message}`);
    const rows = (data ?? []) as AgentRow[];
    for (const r of rows) {
      out.push({
        agentId: String(r.agent_id),
        network: r.network as AgentNetwork,
        owner: "",
        agentURI: "",
        name: "",
        description: "",
        image: null,
        skills: [],
        domains: [],
        x402Support: false,
        serviceEndpoint: null,
        payToWallet: null,
        ensName: null,
        payable: false,
        priceUsdc: null,
        reputation: { count: 0, score: null, scoreNormalized: null },
        createdAtBlock: null,
        createdAt: null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Read every non-revoked feedback row (tags included — needed per-task). */
async function loadFeedback(client: {
  from: (t: string) => any;
}): Promise<FeedbackEntry[]> {
  const out: FeedbackEntry[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("feedback")
      .select(
        "network,agent_id,client,feedback_index,value,value_decimals,score,tag1,tag2,is_revoked,block_number,timestamp",
      )
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load feedback: ${error.message}`);
    const rows = (data ?? []) as FeedbackRow[];
    for (const r of rows) {
      out.push({
        agentId: String(r.agent_id),
        network: r.network as AgentNetwork,
        client: String(r.client ?? "").toLowerCase(),
        feedbackIndex: Number(r.feedback_index ?? 0),
        value: Number(r.value ?? 0),
        valueDecimals: Number(r.value_decimals ?? 0),
        score: Number(r.score ?? 0),
        tag1: r.tag1 ?? "",
        tag2: r.tag2 ?? "",
        feedbackURI: "",
        isRevoked: Boolean(r.is_revoked),
        txHash: null,
        blockNumber: r.block_number != null ? Number(r.block_number) : null,
        timestamp: r.timestamp ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Recompute TrustRank from the indexed feedback and upsert it onto the agents.
 * Returns a summary; no-ops gracefully when Supabase env is absent.
 */
export async function recomputeTrustRank(
  nowMs = Date.now(),
): Promise<RecomputeSummary> {
  if (!hasSupabase()) {
    return { skipped: true, reason: "Supabase env not configured" };
  }

  const { getSupabase } = await import("./supabase.js");
  const client = getSupabase();

  const [agents, feedback] = await Promise.all([
    loadAgents(client),
    loadFeedback(client),
  ]);

  const scores = scoreAgents(feedback, agents, {
    nowMs,
    halfLifeDays: 180,
    pfandBoost: 3,
  });

  const updatedAt = new Date(nowMs).toISOString();
  let rated = 0;

  // Upsert only the score columns per agent (keep card data untouched).
  const updates = agents.map((a) => {
    const s = scores.get(`${a.network}:${a.agentId}`);
    if (s?.trustRank != null) rated++;
    return {
      network: a.network,
      agent_id: a.agentId,
      trustrank: s?.trustRank ?? null,
      trustrank_raw: s?.trustRankRaw ?? null,
      scores_by_task: s?.scoresByTask ?? [],
      distinct_clients: s?.distinctClients ?? 0,
      trustrank_updated_at: updatedAt,
    };
  });

  // Batch the upserts to keep payloads reasonable.
  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const { error } = await client
      .from("agents")
      .upsert(updates.slice(i, i + BATCH), { onConflict: "network,agent_id" });
    if (error) throw new Error(`upsert trustrank: ${error.message}`);
  }

  return {
    agentsScored: agents.length,
    feedbackConsidered: feedback.length,
    ratedAgents: rated,
    updatedAt,
  };
}

// Allow running directly: `tsx src/recompute.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  recomputeTrustRank()
    .then((s) => {
      console.log("[recompute]", JSON.stringify(s, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[recompute] fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
