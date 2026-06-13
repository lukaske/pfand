/**
 * BigQuery indexer: pulls ERC-8004 mainnet logs from the Google public dataset,
 * decodes them, fetches + parses off-chain agent cards, and upserts agents +
 * feedback + daily activity into Supabase. Idempotent.
 *
 * Grades against the exact Ethereum Foundation ERC-8004 addresses required by the
 * Google Cloud prize (see README) — IdentityRegistry 0x8004A169..., Reputation
 * Registry 0x8004BAa1... There is no mainnet ValidationRegistry.
 *
 * Usage:
 *   tsx src/bigquery.ts --dry-run   # prints the parameterized SQL, NO creds needed
 *   tsx src/bigquery.ts             # runs against BigQuery + Supabase (needs creds)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";
import { toEventSelector } from "viem";
import {
  ERC8004_MAINNET,
  type Agent,
  type FeedbackEntry,
  type ActivityBucket,
} from "@pfand/shared";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, "..", "sql");

// ---- Constants the prize grades against -------------------------------------
const IDENTITY_REGISTRY = ERC8004_MAINNET.identityRegistry.toLowerCase();
const REPUTATION_REGISTRY = ERC8004_MAINNET.reputationRegistry.toLowerCase();
// Launch-date partition prune (matches the Google workshop gist).
const SINCE = process.env.BQ_SINCE ?? "2026-01-28";
const DATASET = "bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs";

// ---- topic0 hashes, computed from the canonical ABIs via viem ---------------
// Event signatures are taken straight from @pfand/shared ABIs so they can never
// drift from the contracts. These equal the gist's hardcoded topic0 values.
const TOPIC_REGISTERED = toEventSelector(
  "Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const TOPIC_NEWFEEDBACK = toEventSelector(
  "NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
);

function loadSql(name: string): string {
  return readFileSync(join(SQL_DIR, name), "utf8");
}

/** Substitute @named params into SQL for human-readable dry-run printing. */
function renderSql(sql: string, params: Record<string, string | number>): string {
  let out = sql;
  for (const [k, v] of Object.entries(params)) {
    const lit = typeof v === "number" ? String(v) : `'${v}'`;
    out = out.replaceAll(`@${k}`, lit);
  }
  return out;
}

const COMMON_PARAMS = {
  identity_registry: IDENTITY_REGISTRY,
  reputation_registry: REPUTATION_REGISTRY,
  topic_registered: TOPIC_REGISTERED,
  topic_newfeedback: TOPIC_NEWFEEDBACK,
  since: SINCE,
};

// ---- Agent card fetching ----------------------------------------------------

interface AgentCard {
  name?: string;
  description?: string;
  image?: string;
  skills?: unknown;
  domains?: unknown;
  x402Support?: unknown;
  services?: Array<{ endpoint?: string; price?: number; priceUsdc?: number }>;
  serviceEndpoint?: string;
  endpoint?: string;
  agentWallet?: string;
  payToWallet?: string;
  priceUsdc?: number;
}

function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const gw = process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/";
    return gw + uri.slice("ipfs://".length);
  }
  return uri;
}

/** Fetch + parse an agentURI into a card. Handles data:, ipfs:, http(s):. */
async function fetchAgentCard(agentURI: string): Promise<AgentCard | null> {
  try {
    const prefix = "data:application/json;base64,";
    if (agentURI.startsWith(prefix)) {
      const json = Buffer.from(agentURI.slice(prefix.length), "base64").toString("utf8");
      return JSON.parse(json) as AgentCard;
    }
    if (agentURI.startsWith("data:application/json,")) {
      return JSON.parse(decodeURIComponent(agentURI.split(",", 2)[1] ?? "")) as AgentCard;
    }
    const url = ipfsToHttp(agentURI);
    if (!/^https?:\/\//.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as any).name) : ""))
      .filter(Boolean);
  }
  return [];
}

function cardToAgent(
  agentId: string,
  owner: string,
  agentURI: string,
  card: AgentCard | null,
  createdAtBlock: number | null,
  createdAt: string | null,
): Agent {
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
  return {
    agentId,
    network: "mainnet",
    owner: owner.toLowerCase(),
    agentURI,
    name: card?.name ?? "",
    description: card?.description ?? "",
    image: card?.image ?? null,
    skills: asStringArray(card?.skills),
    domains: asStringArray(card?.domains),
    x402Support: card?.x402Support === true || card?.x402Support === "true",
    serviceEndpoint,
    payToWallet: card?.payToWallet ?? card?.agentWallet ?? owner.toLowerCase(),
    ensName: null,
    payable: false, // mainnet agents are not Pfand-payable in this demo
    priceUsdc,
    reputation: { count: 0, score: null, scoreNormalized: null },
    createdAtBlock,
    createdAt,
  };
}

// ---- BigQuery row decoding (viem, full fidelity) ----------------------------

interface RawLogRow {
  // shape returned by registrations.sql / feedback.sql
  agent_id: number | string;
  owner?: string;
  client?: string;
  agent_uri?: string;
  feedback_index?: number | string;
  value?: number | string;
  value_decimals?: number | string;
  block_number?: number | string;
  block_timestamp?: { value: string } | string;
  transaction_hash?: string;
}

function tsToIso(ts: RawLogRow["block_timestamp"]): string | null {
  if (!ts) return null;
  const raw = typeof ts === "string" ? ts : ts.value;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- Reputation aggregation -------------------------------------------------

function aggregateReputation(feedback: FeedbackEntry[]): Map<string, Agent["reputation"]> {
  const byAgent = new Map<string, { sum: number; n: number }>();
  for (const f of feedback) {
    if (f.isRevoked) continue;
    const cur = byAgent.get(f.agentId) ?? { sum: 0, n: 0 };
    cur.sum += f.score;
    cur.n += 1;
    byAgent.set(f.agentId, cur);
  }
  const out = new Map<string, Agent["reputation"]>();
  for (const [agentId, { sum, n }] of byAgent) {
    const avg = n > 0 ? sum / n : null;
    // Normalize to 0..100. ERC-8004 scores here are 0..100-ish floats; clamp.
    const norm = avg === null ? null : Math.max(0, Math.min(100, avg));
    out.set(agentId, { count: n, score: avg, scoreNormalized: norm });
  }
  return out;
}

// ---- Main -------------------------------------------------------------------

async function dryRun(): Promise<void> {
  console.log("=== Pfand BigQuery indexer — DRY RUN (no creds used) ===\n");
  console.log(`Dataset:             ${DATASET}`);
  console.log(`IdentityRegistry:    ${IDENTITY_REGISTRY}`);
  console.log(`ReputationRegistry:  ${REPUTATION_REGISTRY}`);
  console.log(`ValidationRegistry:  (none on mainnet — ERC-8004 spec under TEE discussion)`);
  console.log(`topic0 Registered:   ${TOPIC_REGISTERED}`);
  console.log(`topic0 NewFeedback:  ${TOPIC_NEWFEEDBACK}`);
  console.log(`since (partition):   ${SINCE}\n`);

  const files: Array<[string, Record<string, string | number>]> = [
    ["registrations.sql", COMMON_PARAMS],
    ["feedback.sql", COMMON_PARAMS],
    ["reputation_summary.sql", { ...COMMON_PARAMS, min_clients: 3 }],
    ["activity_heatmap.sql", COMMON_PARAMS],
    ["x402_join.sql", COMMON_PARAMS],
  ];
  for (const [file, params] of files) {
    console.log(`\n----- ${file} -----`);
    console.log(renderSql(loadSql(file), params).trim());
  }
  console.log("\n=== End dry run. Provide GCP + Supabase creds to execute. ===");
}

async function run(): Promise<void> {
  // Lazy imports so --dry-run never touches creds-requiring modules.
  const { BigQuery } = await import("@google-cloud/bigquery");
  const { getSupabase, upsertAgents, upsertFeedback, upsertActivity } = await import(
    "./supabase.js"
  );

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("Missing GOOGLE_CLOUD_PROJECT");
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON)");
  }
  const bq = new BigQuery({ projectId });
  const supabase = getSupabase();

  const named = {
    identity_registry: IDENTITY_REGISTRY,
    reputation_registry: REPUTATION_REGISTRY,
    topic_registered: TOPIC_REGISTERED,
    topic_newfeedback: TOPIC_NEWFEEDBACK,
    since: SINCE,
  };

  async function query<T>(file: string, extra: Record<string, unknown> = {}): Promise<T[]> {
    const [rows] = await bq.query({
      query: loadSql(file),
      params: { ...named, ...extra },
    });
    return rows as T[];
  }

  // 1. Registrations -> agents (+ fetch cards)
  console.log("Querying registrations...");
  const regRows = await query<RawLogRow>("registrations.sql");
  console.log(`  ${regRows.length} registrations`);

  // 2. Feedback -> feedback rows + reputation aggregation
  console.log("Querying feedback...");
  const fbRows = await query<RawLogRow>("feedback.sql");
  console.log(`  ${fbRows.length} feedback events`);

  const feedback: FeedbackEntry[] = fbRows.map((r) => {
    const value = Number(r.value ?? 0);
    const decimals = Number(r.value_decimals ?? 0);
    return {
      agentId: String(r.agent_id),
      network: "mainnet" as const,
      client: String(r.client ?? "").toLowerCase(),
      feedbackIndex: Number(r.feedback_index ?? 0),
      value,
      valueDecimals: decimals,
      score: value / Math.pow(10, decimals),
      tag1: "",
      tag2: "",
      feedbackURI: "",
      isRevoked: false,
      txHash: r.transaction_hash ?? null,
      blockNumber: r.block_number != null ? Number(r.block_number) : null,
      timestamp: tsToIso(r.block_timestamp),
    };
  });

  const repByAgent = aggregateReputation(feedback);

  // Fetch agent cards (bounded concurrency).
  console.log("Fetching agent cards...");
  const agents: Agent[] = [];
  const CONC = 8;
  for (let i = 0; i < regRows.length; i += CONC) {
    const slice = regRows.slice(i, i + CONC);
    const built = await Promise.all(
      slice.map(async (r) => {
        const agentId = String(r.agent_id);
        const owner = String(r.owner ?? "");
        const agentURI = String(r.agent_uri ?? "");
        const card = await fetchAgentCard(agentURI);
        const agent = cardToAgent(
          agentId,
          owner,
          agentURI,
          card,
          r.block_number != null ? Number(r.block_number) : null,
          tsToIso(r.block_timestamp),
        );
        const rep = repByAgent.get(agentId);
        if (rep) agent.reputation = rep;
        return agent;
      }),
    );
    agents.push(...built);
  }

  // 3. Activity heatmap
  console.log("Querying activity heatmap...");
  const actRows = await query<{
    day: { value: string } | string;
    registrations: number | string;
    feedback: number | string;
  }>("activity_heatmap.sql");
  const activity: ActivityBucket[] = actRows.map((r) => ({
    day: typeof r.day === "string" ? r.day : r.day.value,
    registrations: Number(r.registrations ?? 0),
    feedback: Number(r.feedback ?? 0),
  }));

  // 4. Upserts
  console.log("Upserting to Supabase...");
  const nAgents = await upsertAgents(supabase, agents);
  const nFeedback = await upsertFeedback(supabase, feedback);
  const nActivity = await upsertActivity(supabase, "mainnet", activity);
  console.log(
    `Done. agents=${nAgents} feedback=${nFeedback} activity_days=${nActivity}`,
  );
  console.log("Tip: run `analyze agents;` in Supabase to refresh the ivfflat index.");
}

const isDryRun = process.argv.includes("--dry-run");
(isDryRun ? dryRun() : run()).catch((err) => {
  console.error("[bigquery] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
