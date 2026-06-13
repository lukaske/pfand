/**
 * recompute.ts (app-local) — the "it updates itself" path.
 *
 * Full re-scan of the two mainnet ERC-8004 registries from the Google public
 * BigQuery dataset, upsert into Supabase, run the real EigenTrust engine
 * (scoreAgents), and write TrustRank + trustrank_updated_at back.
 *
 * Deploys STANDALONE on Vercel, so it can't import the indexer package — the SQL
 * is inlined and tag1/tag2 are decoded with a tiny pure-JS ABI string reader
 * (no viem dependency in the app).
 *
 * NO-OP CONTRACT: returns { skipped:true, reason } whenever GCP or Supabase env
 * is missing, so a credentialless deploy can still call the cron route safely.
 *
 * Required env when live:
 *   GCP_PROJECT (or GOOGLE_CLOUD_PROJECT) + GOOGLE_APPLICATION_CREDENTIALS
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_KEY
 *     (or SUPABASE_SERVICE_ROLE_KEY)
 */
import {
  scoreAgents,
  ERC8004_MAINNET,
  type Agent,
  type FeedbackEntry,
} from "@pfand/shared";
import { ensureGcpCredentials } from "./gcp-creds";

// Canonical topic0 hashes (precomputed; avoids a viem dependency in the app).
// keccak256("Registered(uint256,string,address)")
const TOPIC_REGISTERED =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
// keccak256(
//   "NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)"
// )
const TOPIC_NEWFEEDBACK =
  "0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc";

const SINCE = process.env.BQ_SINCE ?? "2026-01-28";
const DATASET =
  "bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs";

const IDENTITY_REGISTRY = ERC8004_MAINNET.identityRegistry.toLowerCase();
const REPUTATION_REGISTRY = ERC8004_MAINNET.reputationRegistry.toLowerCase();

export interface RecomputeSummary {
  skipped?: boolean;
  reason?: string;
  registrations?: number;
  feedback?: number;
  agentsUpserted?: number;
  ratedAgents?: number;
  updatedAt?: string;
  durationMs?: number;
}

function gcpReady(): { ok: boolean; project?: string } {
  ensureGcpCredentials(); // materialize inline SA key (GCP_SA_KEY_B64) on serverless
  const project = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return { ok: Boolean(project && creds), project: project || undefined };
}

function supabaseEnv(): { url?: string; key?: string } {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key:
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/* -------------------------- inlined BigQuery SQL ------------------------- */
// Registrations: agentId from topics[1], owner from topics[2], agentURI in data.
const SQL_REGISTRATIONS = `
SELECT
  SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,
  data                                             AS raw_data,
  block_number,
  block_timestamp,
  transaction_hash
FROM \`${DATASET}\`
WHERE address = @identity_registry
  AND topics[SAFE_OFFSET(0)] = @topic_registered
  AND block_timestamp >= TIMESTAMP(@since)
`;

// Feedback: numeric head slots + full data blob (tag1/tag2 decoded client-side).
const SQL_FEEDBACK = `
SELECT
  SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)              AS agent_id,
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))        AS client,
  SAFE_CAST(CONCAT('0x', SUBSTR(data,   3, 64)) AS INT64) AS feedback_index,
  SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) AS value,
  SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64) AS value_decimals,
  data                                                    AS raw_data,
  block_number,
  block_timestamp,
  transaction_hash
FROM \`${DATASET}\`
WHERE address = @reputation_registry
  AND topics[SAFE_OFFSET(0)] = @topic_newfeedback
  AND block_timestamp >= TIMESTAMP(@since)
`;

/* ------------------------- pure-JS ABI decoders ------------------------- */

/** Strip 0x and return the hex body. */
function body(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/** Read a 32-byte word (hex chars) at word index `w`. */
function word(data: string, w: number): string {
  return data.slice(w * 64, w * 64 + 64);
}

/** Decode a dynamic `string` at byte-offset given by head word `w`. */
function readDynString(data: string, w: number): string {
  const offWord = word(data, w);
  if (!offWord) return "";
  const byteOffset = Number(BigInt("0x" + offWord));
  const lenStart = byteOffset * 2; // bytes -> hex chars
  const lenHex = data.slice(lenStart, lenStart + 64);
  if (!lenHex) return "";
  const len = Number(BigInt("0x" + lenHex));
  if (!len) return "";
  const strHex = data.slice(lenStart + 64, lenStart + 64 + len * 2);
  try {
    return Buffer.from(strHex, "hex").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Decode the agentURI (string) from a Registered `data` blob.
 * Layout: [ offset(agentURI) ][ ...tail: len + bytes ]. agentURI is word 0.
 */
function decodeAgentURI(raw: string): string {
  const data = body(raw);
  if (!data) return "";
  return readDynString(data, 0);
}

/**
 * Decode tag1/tag2 from a NewFeedback `data` blob.
 * Non-indexed head order: feedbackIndex(0), value(1), valueDecimals(2),
 * tag1(3), tag2(4), endpoint(5), feedbackURI(6), feedbackHash(7).
 */
function decodeFeedbackTags(raw: string): { tag1: string; tag2: string } {
  const data = body(raw);
  if (!data || data.length < 64 * 5) return { tag1: "", tag2: "" };
  return { tag1: readDynString(data, 3), tag2: readDynString(data, 4) };
}

function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  const raw =
    typeof ts === "string"
      ? ts
      : typeof ts === "object" && ts && "value" in ts
        ? String((ts as { value: string }).value)
        : "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------ agent cards ----------------------------- */

interface AgentCard {
  name?: string;
  description?: string;
  image?: string;
  skills?: unknown;
  domains?: unknown;
  x402Support?: unknown;
  x402support?: unknown;
  services?: Array<{ endpoint?: string; price?: number; priceUsdc?: number }>;
  serviceEndpoint?: string;
  endpoint?: string;
  agentWallet?: string;
  payToWallet?: string;
  priceUsdc?: number;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string"
          ? x
          : typeof x === "object" && x && "name" in x
            ? String((x as { name?: unknown }).name)
            : "",
      )
      .filter(Boolean);
  }
  return [];
}

async function fetchAgentCard(agentURI: string): Promise<AgentCard | null> {
  try {
    const prefix = "data:application/json;base64,";
    if (agentURI.startsWith(prefix)) {
      const json = Buffer.from(
        agentURI.slice(prefix.length),
        "base64",
      ).toString("utf8");
      return JSON.parse(json) as AgentCard;
    }
    if (agentURI.startsWith("data:application/json,")) {
      return JSON.parse(
        decodeURIComponent(agentURI.split(",", 2)[1] ?? ""),
      ) as AgentCard;
    }
    let url = agentURI;
    if (url.startsWith("ipfs://")) {
      url = (process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/") +
        url.slice("ipfs://".length);
    }
    if (!/^https?:\/\//.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

/* --------------------------------- main --------------------------------- */

interface RegRow {
  agent_id: number | string;
  owner: string;
  raw_data: string;
  block_number: number | string | null;
  block_timestamp: { value: string } | string;
  transaction_hash: string | null;
}
interface FbRow {
  agent_id: number | string;
  client: string;
  feedback_index: number | string;
  value: number | string;
  value_decimals: number | string;
  raw_data: string;
  block_number: number | string | null;
  block_timestamp: { value: string } | string;
  transaction_hash: string | null;
}

/**
 * Full re-scan + recompute. Returns a structured summary; no-ops gracefully
 * when GCP or Supabase env is absent.
 */
export async function recompute(): Promise<RecomputeSummary> {
  const start = Date.now();
  const gcp = gcpReady();
  const { url, key } = supabaseEnv();

  if (!gcp.ok) {
    return { skipped: true, reason: "GCP env not configured (need GCP_PROJECT + GOOGLE_APPLICATION_CREDENTIALS)" };
  }
  if (!url || !key) {
    return { skipped: true, reason: "Supabase env not configured (need SUPABASE_URL + SUPABASE_SERVICE_KEY)" };
  }

  const { BigQuery } = await import("@google-cloud/bigquery");
  const { createClient } = await import("@supabase/supabase-js");

  const bq = new BigQuery({ projectId: gcp.project });
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const params = {
    identity_registry: IDENTITY_REGISTRY,
    reputation_registry: REPUTATION_REGISTRY,
    topic_registered: TOPIC_REGISTERED,
    topic_newfeedback: TOPIC_NEWFEEDBACK,
    since: SINCE,
  };

  const regResult = await bq.query({ query: SQL_REGISTRATIONS, params });
  const regRows = (regResult[0] ?? []) as RegRow[];
  const fbResult = await bq.query({ query: SQL_FEEDBACK, params });
  const fbRows = (fbResult[0] ?? []) as FbRow[];

  // Build feedback with decoded tags.
  const feedback: FeedbackEntry[] = fbRows.map((r) => {
    const value = Number(r.value ?? 0);
    const decimals = Number(r.value_decimals ?? 0);
    const { tag1, tag2 } = decodeFeedbackTags(String(r.raw_data ?? "0x"));
    return {
      agentId: String(r.agent_id),
      network: "mainnet" as const,
      client: String(r.client ?? "").toLowerCase(),
      feedbackIndex: Number(r.feedback_index ?? 0),
      value,
      valueDecimals: decimals,
      score: decimals > 0 ? value / Math.pow(10, decimals) : value,
      tag1,
      tag2,
      feedbackURI: "",
      isRevoked: false,
      txHash: r.transaction_hash ?? null,
      blockNumber: r.block_number != null ? Number(r.block_number) : null,
      timestamp: tsToIso(r.block_timestamp),
    };
  });

  // Average score per agent (for the human-readable reputation_score field).
  const avgByAgent = new Map<string, { sum: number; n: number }>();
  for (const f of feedback) {
    const cur = avgByAgent.get(f.agentId) ?? { sum: 0, n: 0 };
    cur.sum += f.score;
    cur.n += 1;
    avgByAgent.set(f.agentId, cur);
  }

  // Build agents (dedupe by earliest registration); enrich a bounded sample.
  const regByAgent = new Map<string, RegRow>();
  for (const r of regRows) {
    const id = String(r.agent_id);
    if (!regByAgent.has(id)) regByAgent.set(id, r);
  }

  // Enrich cards for agents that have feedback first (demo-relevant), capped.
  const ENRICH_CAP = 80;
  const withFb = [...regByAgent.keys()].filter((id) => avgByAgent.has(id));
  withFb.sort((a, b) => (avgByAgent.get(b)!.n - avgByAgent.get(a)!.n));
  const toEnrich = withFb.slice(0, ENRICH_CAP);
  const cardByAgent = new Map<string, AgentCard | null>();
  const CONC = 8;
  for (let i = 0; i < toEnrich.length; i += CONC) {
    const slice = toEnrich.slice(i, i + CONC);
    await Promise.all(
      slice.map(async (id) => {
        const reg = regByAgent.get(id)!;
        const uri = decodeAgentURI(String(reg.raw_data ?? "0x"));
        cardByAgent.set(id, uri ? await fetchAgentCard(uri) : null);
      }),
    );
  }

  const agents: Agent[] = [...regByAgent.entries()].map(([id, reg]) => {
    const owner = String(reg.owner ?? "").toLowerCase();
    const agentURI = decodeAgentURI(String(reg.raw_data ?? "0x"));
    const card = cardByAgent.get(id) ?? null;
    const service = card?.services?.[0];
    const serviceEndpoint =
      service?.endpoint ?? card?.serviceEndpoint ?? card?.endpoint ?? null;
    const priceUsdc =
      typeof card?.priceUsdc === "number"
        ? card.priceUsdc
        : typeof service?.priceUsdc === "number"
          ? service.priceUsdc
          : typeof service?.price === "number"
            ? service.price
            : null;
    const x402Support =
      card?.x402Support === true ||
      card?.x402Support === "true" ||
      card?.x402support === true ||
      card?.x402support === "true";
    const avg = avgByAgent.get(id);
    const n = avg?.n ?? 0;
    const score = avg && n > 0 ? avg.sum / n : null;
    const norm = score === null ? null : Math.max(0, Math.min(100, score));
    return {
      agentId: id,
      network: "mainnet" as const,
      owner,
      agentURI,
      name: card?.name ?? "",
      description: card?.description ?? "",
      image: card?.image ?? null,
      skills: asStringArray(card?.skills),
      domains: asStringArray(card?.domains),
      x402Support,
      serviceEndpoint,
      payToWallet: card?.payToWallet ?? card?.agentWallet ?? owner,
      ensName: null,
      payable: false,
      priceUsdc,
      reputation: { count: n, score, scoreNormalized: norm },
      createdAtBlock: reg.block_number != null ? Number(reg.block_number) : null,
      createdAt: tsToIso(reg.block_timestamp),
    };
  });

  // Run the real EigenTrust engine over ALL feedback + agents.
  const updatedAt = new Date().toISOString();
  const scores = scoreAgents(feedback, agents, {
    nowMs: Date.now(),
    halfLifeDays: 180,
    pfandBoost: 3,
  });
  let rated = 0;
  for (const a of agents) {
    const s = scores.get(`${a.network}:${a.agentId}`);
    if (s) {
      a.reputation = {
        ...a.reputation,
        trustRank: s.trustRank,
        trustRankRaw: s.trustRankRaw,
        scoresByTask: s.scoresByTask,
        distinctClients: s.distinctClients,
        topTask: s.topTask,
      };
      if (s.trustRank != null) rated++;
    }
  }

  // Upsert agents (without embeddings — those are owned by the indexer path).
  const agentRows = agents.map((a) => ({
    network: a.network,
    agent_id: a.agentId,
    owner: a.owner,
    agent_uri: a.agentURI,
    name: a.name,
    description: a.description,
    image: a.image,
    skills: a.skills,
    domains: a.domains,
    x402_support: a.x402Support,
    service_endpoint: a.serviceEndpoint,
    pay_to_wallet: a.payToWallet,
    ens_name: a.ensName,
    payable: a.payable,
    price_usdc: a.priceUsdc,
    reputation_count: a.reputation.count,
    reputation_score: a.reputation.score,
    reputation_score_normalized: a.reputation.scoreNormalized,
    trustrank: a.reputation.trustRank ?? null,
    trustrank_raw: a.reputation.trustRankRaw ?? null,
    scores_by_task: a.reputation.scoresByTask ?? [],
    distinct_clients: a.reputation.distinctClients ?? 0,
    trustrank_updated_at: updatedAt,
    created_at_block: a.createdAtBlock,
    created_at: a.createdAt,
  }));

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < agentRows.length; i += BATCH) {
    const chunk = agentRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("agents")
      .upsert(chunk, { onConflict: "network,agent_id" });
    if (error) throw new Error(`upsert agents: ${error.message}`);
    upserted += chunk.length;
  }

  // Upsert feedback rows too (idempotent), so the DB graph stays complete.
  const fbUpsertRows = feedback.map((f) => ({
    network: f.network,
    agent_id: f.agentId,
    client: f.client,
    feedback_index: f.feedbackIndex,
    value: f.value,
    value_decimals: f.valueDecimals,
    score: f.score,
    tag1: f.tag1,
    tag2: f.tag2,
    feedback_uri: f.feedbackURI,
    is_revoked: f.isRevoked,
    tx_hash: f.txHash,
    block_number: f.blockNumber,
    timestamp: f.timestamp,
  }));
  for (let i = 0; i < fbUpsertRows.length; i += BATCH) {
    const chunk = fbUpsertRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("feedback")
      .upsert(chunk, { onConflict: "network,agent_id,client,feedback_index" });
    if (error) throw new Error(`upsert feedback: ${error.message}`);
  }

  return {
    registrations: regRows.length,
    feedback: feedback.length,
    agentsUpserted: upserted,
    ratedAgents: rated,
    updatedAt,
    durationMs: Date.now() - start,
  };
}
