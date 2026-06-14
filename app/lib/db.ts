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
  type Payment,
  type Evidence,
  type TrustScore,
} from "@pfand/shared";
import { getScoredData, getScoredAgents, allFeedback } from "@/lib/scored";
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
  evidence: Evidence | null;
  distrust_flag: boolean | null;
  tags: { tag: string; count: number }[] | null;
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
      // v2 enrichment: evidence / distrustFlag / tags from the trust engine.
      evidence: r.evidence ?? undefined,
      distrustFlag: r.distrust_flag ?? false,
      tags: r.tags ?? [],
      // back-compat: distinctClients tracks distinct review count.
      distinctClients: r.evidence?.distinctReviews ?? 0,
      topTask: r.tags?.[0]?.tag ?? r.scores_by_task?.[0]?.tag ?? null,
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
  "evidence,distrust_flag,tags," +
  "created_at_block,created_at";

const FEEDBACK_COLS =
  "network,agent_id,client,feedback_index,value,value_decimals,score," +
  "tag1,tag2,feedback_uri,is_revoked,tx_hash,block_number,timestamp";

const PAYMENT_COLS =
  "network,from_addr,to_agent_id,amount_usdc,ts,pfand_verified,tx_hash";

interface PaymentDbRow {
  network: string;
  from_addr: string;
  to_agent_id: string;
  amount_usdc: number | string;
  ts: string | null;
  pfand_verified: boolean | null;
  tx_hash: string | null;
}

function rowToPayment(r: PaymentDbRow): Payment {
  return {
    from: String(r.from_addr ?? "").toLowerCase(),
    toAgentId: String(r.to_agent_id),
    network: r.network as AgentNetwork,
    amountUsdc: Number(r.amount_usdc ?? 0),
    timestamp: r.ts,
    pfandVerified: Boolean(r.pfand_verified),
  };
}

/* -------------------------- Supabase reads ------------------------------ */

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

/* ------------------------------- public --------------------------------- */

/**
 * Display agents: every RATED on-chain agent (has a TrustRank). Named agents
 * show their card; the rest render as `Agent #<id>` bare NFTs. Ordered by
 * TrustRank desc, capped. Scores are precomputed in the DB. Falls back to the
 * seed corpus when Supabase isn't configured.
 */
export async function getAgents(): Promise<Agent[]> {
  if (!hasSupabase()) return getScoredAgents();
  try {
    const client = await supa();
    // Rated agents (mainnet), PLUS every Arc agent (our live brokered agents,
    // shown even before they've earned a TrustRank). Two queries — robust vs
    // PostgREST's quirky `or(is.null)` handling.
    const [ratedRes, arcRes] = await Promise.all([
      client
        .from("agents")
        .select(AGENT_COLS)
        .not("trustrank", "is", null)
        .order("trustrank", { ascending: false, nullsFirst: false })
        .limit(2000),
      client.from("agents").select(AGENT_COLS).eq("network", "arc"),
    ]);
    if (ratedRes.error) throw new Error(ratedRes.error.message);
    const rows = [
      ...((arcRes.data ?? []) as unknown as AgentDbRow[]),
      ...((ratedRes.data ?? []) as unknown as AgentDbRow[]),
    ];
    if (rows.length === 0) return getScoredAgents();
    return rows.map(rowToAgent);
  } catch (err) {
    console.error("[db] getAgents fell back to seed:", err);
    return getScoredAgents();
  }
}

/** All feedback entries (for building the trust-flow graph). Seed fallback. */
export async function getAllFeedback(): Promise<FeedbackEntry[]> {
  if (!hasSupabase()) return allFeedback();
  try {
    return (await fetchAllFeedback()).map(rowToFeedback);
  } catch (err) {
    console.error("[db] getAllFeedback fell back to seed:", err);
    return allFeedback();
  }
}

/**
 * All payment flows (for building the payment edges of the trust graph).
 * The seed corpus carries no on-chain payments, so the no-creds / error path
 * returns [] (reviews still drive the graph).
 */
export async function getAllPayments(): Promise<Payment[]> {
  if (!hasSupabase()) return [];
  try {
    const client = await supa();
    const out: PaymentDbRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("payments")
        .select(PAYMENT_COLS)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`payments read: ${error.message}`);
      const rows = (data ?? []) as unknown as PaymentDbRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out.map(rowToPayment);
  } catch (err) {
    console.error("[db] getAllPayments fell back to empty:", err);
    return [];
  }
}

/* ----------------------- Pfand broker loop writes ----------------------- */

/** Insert one Arc sign-review into the feedback table (real on-chain review). */
export async function insertArcFeedback(p: {
  agentId: string;
  client: string;
  value: number;
  tag1: string;
  tag2: string;
  txHash: string;
}): Promise<number> {
  const c = await supa();
  const client = p.client.toLowerCase();
  const { data } = await c
    .from("feedback")
    .select("feedback_index")
    .eq("network", "arc")
    .eq("agent_id", p.agentId)
    .eq("client", client)
    .order("feedback_index", { ascending: false })
    .limit(1);
  const next = Number((data ?? [])[0]?.feedback_index ?? 0) + 1;
  const { error } = await c.from("feedback").insert({
    network: "arc",
    agent_id: p.agentId,
    client,
    feedback_index: next,
    value: p.value,
    value_decimals: 0,
    score: p.value,
    tag1: p.tag1,
    tag2: p.tag2,
    feedback_uri: "",
    is_revoked: false,
    tx_hash: p.txHash,
    block_number: null,
    timestamp: new Date().toISOString(),
  });
  if (error) throw new Error(`insert feedback: ${error.message}`);
  return next;
}

/**
 * Re-run the TrustRank engine over the scorable corpus (rated agents + all Arc
 * agents) and write the fresh scores for the Arc agents. Cheap — only loads the
 * ~1.6k agents that have any history, not the full 34k. Used after a review lands
 * so the agent's TrustRank updates immediately.
 */
export async function rescoreArc(): Promise<Map<string, TrustScore>> {
  const c = await supa();
  const PAGE = 1000;
  const rated: AgentDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c
      .from("agents")
      .select(AGENT_COLS)
      .not("trustrank", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as AgentDbRow[];
    rated.push(...rows);
    if (rows.length < PAGE) break;
  }
  const arcRes = await c.from("agents").select(AGENT_COLS).eq("network", "arc");
  const arcRows = (arcRes.data ?? []) as unknown as AgentDbRow[];

  const agents = [...arcRows, ...rated].map(rowToAgent);
  const feedback = (await fetchAllFeedback()).map(rowToFeedback);
  const payments = await getAllPayments();
  const scores = scoreAgents(feedback, agents, {
    nowMs: Date.now(),
    halfLifeDays: 180,
    pfandBoost: 3,
    payments,
  });

  const updatedAt = new Date().toISOString();
  for (const r of arcRows) {
    const s = scores.get(`arc:${r.agent_id}`);
    await c
      .from("agents")
      .update({
        trustrank: s?.trustRank ?? null,
        trustrank_raw: s?.trustRankRaw ?? null,
        evidence: s?.evidence ?? null,
        distrust_flag: s?.distrustFlag ?? false,
        tags: s?.tags ?? [],
        distinct_clients: s?.evidence.distinctReviews ?? 0,
        reputation_count: s?.evidence.distinctReviews ?? 0,
        trustrank_updated_at: updatedAt,
      })
      .eq("network", "arc")
      .eq("agent_id", r.agent_id);
  }
  return scores;
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
      // agentIds collide across chains; prefer our Arc agents ("arc" < "mainnet").
      .order("network", { ascending: true })
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
