/**
 * db.ts — canonical read layer for the app's API routes.
 *
 * Strategy:
 *   - If Supabase env (SUPABASE_URL + SUPABASE_SERVICE_KEY) is present, read
 *     agents + feedback + activity from Postgres and attach TrustRank. We prefer
 *     precomputed trustrank columns; if they're absent we compute on the fly with
 *     scoreAgents over the DB feedback so the UI always has a TrustRank.
 *   - Otherwise, defer to getScoredData()/getScoredAgents() from "@/lib/scored",
 *     the offline/no-creds path that runs the engine over the seed corpus.
 *
 * Return shapes are byte-compatible with the legacy routes:
 *   getAgents()  -> Agent[]            (reputation.trustRank populated)
 *   getAgent(id) -> { agent, feedback } | null
 *   getStats()   -> IndexStats
 *   getActivity()-> ActivityBucket[]
 *   getUpdatedAt() -> string | null    (trustrank_updated_at, for "scores updated …")
 */
import {
  scoreAgents,
  type Agent,
  type FeedbackEntry,
  type IndexStats,
  type ActivityBucket,
  type AgentNetwork,
  type TaskScore,
} from "@pfand/shared";
import { getScoredData, getScoredAgents } from "@/lib/scored";
import {
  getAgent as getSeedAgent,
  getFeedback as getSeedFeedback,
  STATS,
  ACTIVITY,
} from "@/lib/seed";

function hasSupabase(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

/* --------------------------- Supabase client ---------------------------- */

let _client: import("@supabase/supabase-js").SupabaseClient | null = null;

async function supa(): Promise<import("@supabase/supabase-js").SupabaseClient> {
  if (_client) return _client;
  const { createClient } = await import("@supabase/supabase-js");
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!;
  const key = (process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY)!;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/* ----------------------------- row mapping ------------------------------ */

interface AgentDbRow {
  network: string;
  agent_id: string;
  owner: string | null;
  agent_uri: string | null;
  name: string | null;
  description: string | null;
  image: string | null;
  skills: string[] | null;
  domains: string[] | null;
  x402_support: boolean | null;
  service_endpoint: string | null;
  pay_to_wallet: string | null;
  ens_name: string | null;
  payable: boolean | null;
  price_usdc: number | null;
  reputation_count: number | null;
  reputation_score: number | null;
  reputation_score_normalized: number | null;
  trustrank: number | null;
  trustrank_raw: number | null;
  scores_by_task: TaskScore[] | null;
  distinct_clients: number | null;
  trustrank_updated_at: string | null;
  created_at_block: number | null;
  created_at: string | null;
}

interface FeedbackDbRow {
  network: string;
  agent_id: string;
  client: string;
  feedback_index: number | string;
  value: number | string;
  value_decimals: number | string;
  score: number | string;
  tag1: string | null;
  tag2: string | null;
  feedback_uri: string | null;
  is_revoked: boolean | null;
  tx_hash: string | null;
  block_number: number | string | null;
  timestamp: string | null;
}

function rowToAgent(r: AgentDbRow): Agent {
  return {
    agentId: String(r.agent_id),
    network: r.network as AgentNetwork,
    owner: r.owner ?? "",
    agentURI: r.agent_uri ?? "",
    name: r.name ?? "",
    description: r.description ?? "",
    image: r.image,
    skills: r.skills ?? [],
    domains: r.domains ?? [],
    x402Support: Boolean(r.x402_support),
    serviceEndpoint: r.service_endpoint,
    payToWallet: r.pay_to_wallet,
    ensName: r.ens_name,
    payable: Boolean(r.payable),
    priceUsdc: r.price_usdc,
    reputation: {
      count: r.reputation_count ?? 0,
      score: r.reputation_score,
      scoreNormalized: r.reputation_score_normalized,
      trustRank: r.trustrank ?? null,
      trustRankRaw: r.trustrank_raw ?? null,
      scoresByTask: r.scores_by_task ?? [],
      distinctClients: r.distinct_clients ?? 0,
      topTask: r.scores_by_task?.[0]?.tag ?? null,
    },
    createdAtBlock: r.created_at_block,
    createdAt: r.created_at,
  };
}

function rowToFeedback(r: FeedbackDbRow): FeedbackEntry {
  return {
    agentId: String(r.agent_id),
    network: r.network as AgentNetwork,
    client: String(r.client ?? "").toLowerCase(),
    feedbackIndex: Number(r.feedback_index ?? 0),
    value: Number(r.value ?? 0),
    valueDecimals: Number(r.value_decimals ?? 0),
    score: Number(r.score ?? 0),
    tag1: r.tag1 ?? "",
    tag2: r.tag2 ?? "",
    feedbackURI: r.feedback_uri ?? "",
    isRevoked: Boolean(r.is_revoked),
    txHash: r.tx_hash,
    blockNumber: r.block_number != null ? Number(r.block_number) : null,
    timestamp: r.timestamp,
  };
}

const AGENT_COLS =
  "network,agent_id,owner,agent_uri,name,description,image,skills,domains," +
  "x402_support,service_endpoint,pay_to_wallet,ens_name,payable,price_usdc," +
  "reputation_count,reputation_score,reputation_score_normalized," +
  "trustrank,trustrank_raw,scores_by_task,distinct_clients,trustrank_updated_at," +
  "created_at_block,created_at";

const FEEDBACK_COLS =
  "network,agent_id,client,feedback_index,value,value_decimals,score," +
  "tag1,tag2,feedback_uri,is_revoked,tx_hash,block_number,timestamp";

/* -------------------------- Supabase reads ------------------------------ */

async function fetchAllAgents(): Promise<AgentDbRow[]> {
  const client = await supa();
  const out: AgentDbRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("agents")
      .select(AGENT_COLS)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`agents read: ${error.message}`);
    const rows = (data ?? []) as unknown as AgentDbRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchAllFeedback(): Promise<FeedbackDbRow[]> {
  const client = await supa();
  const out: FeedbackDbRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("feedback")
      .select(FEEDBACK_COLS)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`feedback read: ${error.message}`);
    const rows = (data ?? []) as unknown as FeedbackDbRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Attach TrustRank to agents. If every agent already has a precomputed
 * `trustRank`, keep it; otherwise recompute over the supplied feedback so the
 * UI never shows a missing score.
 */
function withScores(agents: Agent[], feedback: FeedbackEntry[]): Agent[] {
  const anyRated = agents.some((a) => a.reputation.trustRank != null);
  if (anyRated) return agents;
  const scores = scoreAgents(feedback, agents, {
    nowMs: Date.now(),
    halfLifeDays: 180,
    pfandBoost: 3,
  });
  return agents.map((a) => {
    const s = scores.get(`${a.network}:${a.agentId}`);
    if (!s) return a;
    return {
      ...a,
      reputation: {
        ...a.reputation,
        trustRank: s.trustRank,
        trustRankRaw: s.trustRankRaw,
        scoresByTask: s.scoresByTask,
        distinctClients: s.distinctClients,
        topTask: s.topTask,
      },
    };
  });
}

/* ------------------------------- public --------------------------------- */

/** All agents, with reputation.trustRank populated. */
export async function getAgents(): Promise<Agent[]> {
  if (!hasSupabase()) return getScoredAgents();
  try {
    const [agentRows, feedbackRows] = await Promise.all([
      fetchAllAgents(),
      fetchAllFeedback(),
    ]);
    if (agentRows.length === 0) return getScoredAgents();
    const agents = agentRows.map(rowToAgent);
    const feedback = feedbackRows.map(rowToFeedback);
    return withScores(agents, feedback);
  } catch (err) {
    console.error("[db] getAgents fell back to seed:", err);
    return getScoredAgents();
  }
}

/** A single agent + its feedback, or null if not found. */
export async function getAgent(
  id: string,
): Promise<{ agent: Agent; feedback: FeedbackEntry[] } | null> {
  if (!hasSupabase()) {
    const agent = getSeedAgent(id);
    if (!agent) return null;
    // getScoredAgents() carries trustRank; match by agentId for the enriched copy.
    const scored = getScoredAgents().find((a) => a.agentId === id) ?? agent;
    return { agent: scored, feedback: getSeedFeedback(id) };
  }
  try {
    const client = await supa();
    const { data: aData, error: aErr } = await client
      .from("agents")
      .select(AGENT_COLS)
      .eq("agent_id", id)
      .limit(1);
    if (aErr) throw new Error(aErr.message);
    const row = (aData ?? [])[0] as unknown as AgentDbRow | undefined;
    if (!row) return null;

    const { data: fData, error: fErr } = await client
      .from("feedback")
      .select(FEEDBACK_COLS)
      .eq("agent_id", id);
    if (fErr) throw new Error(fErr.message);
    const feedback = ((fData ?? []) as unknown as FeedbackDbRow[]).map(rowToFeedback);

    let agent = rowToAgent(row);
    if (agent.reputation.trustRank == null) {
      // Single-agent recompute needs the global graph; use full scoring fallback.
      const all = await getAgents();
      agent = all.find((a) => a.agentId === id && a.network === agent.network) ?? agent;
    }
    return { agent, feedback };
  } catch (err) {
    console.error("[db] getAgent fell back to seed:", err);
    const agent = getSeedAgent(id);
    if (!agent) return null;
    const scored = getScoredAgents().find((a) => a.agentId === id) ?? agent;
    return { agent: scored, feedback: getSeedFeedback(id) };
  }
}

/** Index-level stats. */
export async function getStats(): Promise<IndexStats> {
  if (!hasSupabase()) return STATS;
  try {
    const client = await supa();
    const [agentsCount, fbCount, mainnetCount, arcCount] = await Promise.all([
      client.from("agents").select("*", { count: "exact", head: true }),
      client.from("feedback").select("*", { count: "exact", head: true }),
      client
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("network", "mainnet"),
      client
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("network", "arc"),
    ]);
    if (agentsCount.error || (agentsCount.count ?? 0) === 0) return STATS;
    return {
      agentsIndexed: agentsCount.count ?? STATS.agentsIndexed,
      feedbackSignals: fbCount.count ?? STATS.feedbackSignals,
      usdcEscrowed: STATS.usdcEscrowed,
      pfandReturnedPct: STATS.pfandReturnedPct,
      byNetwork: {
        mainnet: mainnetCount.count ?? STATS.byNetwork.mainnet,
        arc: arcCount.count ?? STATS.byNetwork.arc,
      },
    };
  } catch (err) {
    console.error("[db] getStats fell back to seed:", err);
    return STATS;
  }
}

/** Daily activity buckets (sorted by day asc). */
export async function getActivity(): Promise<ActivityBucket[]> {
  if (!hasSupabase()) return getScoredActivity();
  try {
    const client = await supa();
    const { data, error } = await client
      .from("activity")
      .select("day,registrations,feedback")
      .order("day", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      day: string;
      registrations: number;
      feedback: number;
    }>;
    if (rows.length === 0) return getScoredActivity();
    // Collapse per-network rows into one bucket per day.
    const byDay = new Map<string, ActivityBucket>();
    for (const r of rows) {
      const cur = byDay.get(r.day) ?? { day: r.day, registrations: 0, feedback: 0 };
      cur.registrations += Number(r.registrations ?? 0);
      cur.feedback += Number(r.feedback ?? 0);
      byDay.set(r.day, cur);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  } catch (err) {
    console.error("[db] getActivity fell back to seed:", err);
    return getScoredActivity();
  }
}

/** When TrustRank was last recomputed (max trustrank_updated_at), or scored data ts. */
export async function getUpdatedAt(): Promise<string | null> {
  if (!hasSupabase()) return getScoredData().updatedAt;
  try {
    const client = await supa();
    const { data, error } = await client
      .from("agents")
      .select("trustrank_updated_at")
      .not("trustrank_updated_at", "is", null)
      .order("trustrank_updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const ts = (data ?? [])[0]?.trustrank_updated_at as string | undefined;
    return ts ?? getScoredData().updatedAt;
  } catch (err) {
    console.error("[db] getUpdatedAt fell back to seed:", err);
    return getScoredData().updatedAt;
  }
}

/** Seed activity buckets — the no-creds fallback for getActivity(). */
function getScoredActivity(): ActivityBucket[] {
  return ACTIVITY;
}
