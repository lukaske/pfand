/**
 * pull-real-agents.ts — one-shot puller for REAL Ethereum-mainnet ERC-8004 agents.
 *
 * Reads the Google public dataset (bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs),
 * decodes the canonical ERC-8004 IdentityRegistry `Registered` and ReputationRegistry
 * `NewFeedback` events, aggregates reputation per agent, fetches a sample of agent-card
 * metadata over HTTP, and writes a single cached JSON blob to
 *   indexer/scripts/real-agents.cache.json   (gitignored)
 * which `app/lib/seed.ts` is hand-merged from.
 *
 * COST: scans the logs partition ONCE (one BigQuery job, all CTEs share the scan).
 * Guarded with --maximum_bytes_billed. Run AT MOST once — the cache is reused after.
 *
 * Usage:
 *   set -a; source ../../.env; set +a
 *   npx tsx pull-real-agents.ts            # runs the query (needs GCP creds) + enriches
 *   npx tsx pull-real-agents.ts --enrich   # re-run HTTP enrichment from existing raw cache
 *
 * The prize grades against the exact Ethereum-Foundation ERC-8004 addresses:
 *   IdentityRegistry   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   ReputationRegistry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toEventSelector, decodeEventLog } from "viem";
import { ERC8004_MAINNET, reputationRegistryAbi, identityRegistryAbi } from "@pfand/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_CACHE = join(__dirname, "real-agents.raw.json");
const OUT_CACHE = join(__dirname, "real-agents.cache.json");

const IDENTITY_REGISTRY = ERC8004_MAINNET.identityRegistry.toLowerCase();
const REPUTATION_REGISTRY = ERC8004_MAINNET.reputationRegistry.toLowerCase();
const SINCE = process.env.BQ_SINCE ?? "2026-01-28";
const DATASET = "bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs";
const MAX_BYTES = process.env.BQ_MAX_BYTES ?? "220000000000"; // ~220GB cap

const TOPIC_REGISTERED = toEventSelector(
  "Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const TOPIC_NEWFEEDBACK = toEventSelector(
  "NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
);

// ---------------------------------------------------------------------------
// Single combined query. One pass over the partition (address IN both registries),
// then CTEs split registrations vs feedback. We return:
//   - reg rows: raw topics + data (decoded client-side via viem for fidelity)
//   - fb  rows: raw topics + data
//   - activity: daily reg/fb counts
// We pull ALL feedback (~3.2k rows) and ALL registrations (~34k rows) — the cost
// is the partition SCAN, not the row count.
//
// COST MODEL (measured via --dry_run against this exact table/partition):
//   - The `topics` column alone over the partition ≈ 192GB.
//   - The `data`   column alone over the partition ≈ 151GB.
//   - Selecting BOTH `topics` AND `data` in one job ≈ 362GB  -> over the 220GB cap.
// The address/topic0 WHERE filter does NOT prune the columnar scan, so a single
// "give me everything" query is unavoidably ~362GB. We therefore SPLIT into two
// jobs, each < the 220GB cap, and JOIN them CLIENT-SIDE on (transaction_hash, log_index):
//
//   Q_TOPICS  selects topics + ts + tx + log_index            (~218GB) -> agentId, owner/client
//   Q_DATA    selects data   + bn + ts + tx + log_index + addr (~218GB) -> agentURI / feedback payload
//
// Each is independently guarded with maximumBytesBilled = MAX_BYTES (220GB default).

const Q_TOPICS = `
SELECT
  CASE
    WHEN topics[SAFE_OFFSET(0)] = @topic_registered  THEN 'reg'
    WHEN topics[SAFE_OFFSET(0)] = @topic_newfeedback THEN 'fb'
  END AS kind,
  topics[SAFE_OFFSET(1)]                           AS agent_id_hex,
  CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS addr2,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', block_timestamp) AS ts,
  transaction_hash,
  log_index
FROM \`${DATASET}\`
WHERE block_timestamp >= TIMESTAMP(@since)
  AND topics[SAFE_OFFSET(0)] IN (@topic_registered, @topic_newfeedback)
`;

const Q_DATA = `
SELECT
  LOWER(address)                                   AS address,
  data                                             AS raw_data,
  CAST(block_number AS INT64)                      AS block_number,
  transaction_hash,
  log_index
FROM \`${DATASET}\`
WHERE block_timestamp >= TIMESTAMP(@since)
  AND LOWER(address) IN (@identity_registry, @reputation_registry)
`;

interface TopicRow {
  kind: "reg" | "fb";
  agent_id_hex: string;
  addr2: string; // owner (reg) or client (fb)
  ts: string;
  transaction_hash: string;
  log_index: number;
}
interface DataRow {
  address: string;
  raw_data: string;
  block_number: number;
  transaction_hash: string;
  log_index: number;
}

// ---------------------------------------------------------------------------
// Types of the cached raw blob.
// ---------------------------------------------------------------------------
interface RawReg {
  agent_id_hex: string;
  owner: string;
  raw_data: string;
  block_number: number;
  ts: string;
  transaction_hash: string;
}
interface RawFb {
  agent_id_hex: string;
  client: string;
  raw_data: string;
  block_number: number;
  ts: string;
  transaction_hash: string;
}
interface RawActivity {
  day: string;
  registrations: number;
  feedback: number;
}
interface RawPayload {
  registrations: RawReg[];
  feedback: RawFb[];
}

/** Daily activity heatmap, derived client-side from reg/fb timestamps. */
function deriveActivity(payload: RawPayload): RawActivity[] {
  const byDay = new Map<string, { registrations: number; feedback: number }>();
  for (const r of payload.registrations) {
    const day = (r.ts ?? "").slice(0, 10);
    if (!day) continue;
    const cur = byDay.get(day) ?? { registrations: 0, feedback: 0 };
    cur.registrations += 1;
    byDay.set(day, cur);
  }
  for (const f of payload.feedback) {
    const day = (f.ts ?? "").slice(0, 10);
    if (!day) continue;
    const cur = byDay.get(day) ?? { registrations: 0, feedback: 0 };
    cur.feedback += 1;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, registrations: v.registrations, feedback: v.feedback }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------------------
// viem decoders. The Registered/NewFeedback ABIs come straight from @pfand/shared.
// ---------------------------------------------------------------------------
const REGISTERED_ABI = identityRegistryAbi.filter(
  (e) => e.type === "event" && e.name === "Registered",
);
const NEWFEEDBACK_ABI = reputationRegistryAbi.filter(
  (e) => e.type === "event" && e.name === "NewFeedback",
);

function decodeRegistered(hex: string): { agentId: bigint; owner: string; agentURI: string } | null {
  try {
    // topics[1]=agentId, topics[2]=owner are indexed; data holds agentURI (string).
    // We feed the full topic set so decodeEventLog can reconstruct indexed args.
    const { args } = decodeEventLog({
      abi: REGISTERED_ABI,
      data: hex as `0x${string}`,
      // agentId + owner are indexed; topic0 is the event selector. We only need agentURI
      // from `data`, but decodeEventLog requires topics for indexed args, so pass dummies.
      topics: [TOPIC_REGISTERED, "0x" + "0".repeat(64) as `0x${string}`, "0x" + "0".repeat(64) as `0x${string}`],
    }) as unknown as { args: { agentURI: string } };
    return { agentId: 0n, owner: "", agentURI: args.agentURI };
  } catch {
    return null;
  }
}

function decodeFeedback(
  hex: string,
): { value: bigint; valueDecimals: number; tag1: string; tag2: string; feedbackURI: string; feedbackIndex: bigint } | null {
  try {
    const { args } = decodeEventLog({
      abi: NEWFEEDBACK_ABI,
      data: hex as `0x${string}`,
      // agentId, clientAddress, indexedTag1 are indexed → pass placeholders.
      topics: [
        TOPIC_NEWFEEDBACK,
        ("0x" + "0".repeat(64)) as `0x${string}`,
        ("0x" + "0".repeat(64)) as `0x${string}`,
        ("0x" + "0".repeat(64)) as `0x${string}`,
      ],
    }) as unknown as {
      args: {
        feedbackIndex: bigint;
        value: bigint;
        valueDecimals: number;
        tag1: string;
        tag2: string;
        feedbackURI: string;
      };
    };
    return {
      value: args.value,
      valueDecimals: Number(args.valueDecimals),
      tag1: args.tag1 ?? "",
      tag2: args.tag2 ?? "",
      feedbackURI: args.feedbackURI ?? "",
      feedbackIndex: args.feedbackIndex,
    };
  } catch {
    return null;
  }
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

// ---------------------------------------------------------------------------
// Agent-card fetching (bounded, graceful).
// ---------------------------------------------------------------------------
interface AgentCard {
  name?: string;
  description?: string;
  image?: string;
  skills?: unknown;
  capabilities?: unknown;
  domains?: unknown;
  supportedTrusts?: unknown;
  x402Support?: unknown;
  x402support?: unknown; // real ERC-8004 cards use this casing
  services?: Array<{ name?: string; endpoint?: string; price?: number; priceUsdc?: number }>;
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
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/json/.test(ct)) {
      // Some cards are served as text/plain; try to parse anyway, bail on HTML.
      const text = await res.text();
      if (/^\s*</.test(text)) return null;
      return JSON.parse(text) as AgentCard;
    }
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

/** Map a raw feedback tag to a coarse domain bucket for the UI filters. */
function tagToDomain(tag: string): string | null {
  const t = tag.toLowerCase();
  if (/trust|oracle|screening|review|audit/.test(t)) return "trust";
  if (/live|reach|health|uptime|response/.test(t)) return "reliability";
  if (/mcp|a2a|web|service|api/.test(t)) return "infrastructure";
  if (/trade|defi|alpha|market|odds|predict/.test(t)) return "defi";
  if (/quality|helpful|useful|accurate|good|fast|star/.test(t)) return "quality";
  return null;
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

// ---------------------------------------------------------------------------
// Output shape for the cache (a superset of what seed.ts needs).
// ---------------------------------------------------------------------------
interface OutAgent {
  agentId: string;
  owner: string;
  agentURI: string;
  name: string;
  description: string;
  image: string | null;
  skills: string[];
  domains: string[];
  x402Support: boolean;
  serviceEndpoint: string | null;
  payToWallet: string | null;
  priceUsdc: number | null;
  feedbackCount: number;
  avgScore: number | null;
  createdAtBlock: number | null;
  createdAt: string | null;
  enriched: boolean;
}
interface OutFeedback {
  agentId: string;
  client: string;
  feedbackIndex: number;
  value: number;
  valueDecimals: number;
  score: number;
  tag1: string;
  tag2: string;
  feedbackURI: string;
  isRevoked: boolean;
  txHash: string | null;
  blockNumber: number | null;
  timestamp: string | null;
}
interface OutCache {
  pulledAt: string;
  totals: { registrations: number; feedback: number };
  agents: OutAgent[];
  feedbackByAgent: Record<string, OutFeedback[]>;
  activity: RawActivity[];
}

// ---------------------------------------------------------------------------
async function runQuery(): Promise<RawPayload> {
  const { BigQuery } = await import("@google-cloud/bigquery");
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("Missing GOOGLE_CLOUD_PROJECT");
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");
  }
  const bq = new BigQuery({ projectId });

  const params = {
    identity_registry: IDENTITY_REGISTRY,
    reputation_registry: REPUTATION_REGISTRY,
    topic_registered: TOPIC_REGISTERED,
    topic_newfeedback: TOPIC_NEWFEEDBACK,
    since: SINCE,
  };

  async function runJob<T>(label: string, query: string): Promise<T[]> {
    console.log(`Running BigQuery job: ${label} ...`);
    const [job] = await bq.createQueryJob({ query, params, maximumBytesBilled: MAX_BYTES });
    const [rows] = await job.getQueryResults();
    const meta = await job.getMetadata();
    const billed = Number(meta?.[0]?.statistics?.query?.totalBytesBilled ?? 0);
    console.log(`  ${label}: rows=${rows.length} bytesBilled=${billed} (~$${(billed / 1e12 * 6.25).toFixed(2)})`);
    return rows as T[];
  }

  // Two sub-220GB jobs joined client-side on (transaction_hash, log_index).
  const topicRows = await runJob<TopicRow>("topics (agentId/owner/client)", Q_TOPICS);
  const dataRows = await runJob<DataRow>("data (agentURI/feedback payload)", Q_DATA);

  const dataByKey = new Map<string, DataRow>();
  for (const d of dataRows) dataByKey.set(`${d.transaction_hash}:${d.log_index}`, d);

  const payload: RawPayload = { registrations: [], feedback: [] };
  for (const t of topicRows) {
    const d = dataByKey.get(`${t.transaction_hash}:${t.log_index}`);
    const raw_data = d?.raw_data ?? "0x";
    const block_number = d?.block_number ?? 0;
    if (t.kind === "reg") {
      payload.registrations.push({
        agent_id_hex: t.agent_id_hex,
        owner: t.addr2,
        raw_data,
        block_number,
        ts: t.ts,
        transaction_hash: t.transaction_hash,
      });
    } else if (t.kind === "fb") {
      payload.feedback.push({
        agent_id_hex: t.agent_id_hex,
        client: t.addr2,
        raw_data,
        block_number,
        ts: t.ts,
        transaction_hash: t.transaction_hash,
      });
    }
  }
  // Stable chronological order.
  payload.registrations.sort((a, b) => a.ts.localeCompare(b.ts));
  payload.feedback.sort((a, b) => a.ts.localeCompare(b.ts));

  writeFileSync(RAW_CACHE, JSON.stringify(payload), "utf8");
  console.log(`  raw cache -> ${RAW_CACHE}`);
  console.log(`  registrations=${payload.registrations.length} feedback=${payload.feedback.length}`);
  const joined = payload.registrations.filter((r) => r.raw_data !== "0x").length +
    payload.feedback.filter((f) => f.raw_data !== "0x").length;
  console.log(`  rows with joined data payload: ${joined}/${topicRows.length}`);
  return payload;
}

async function enrich(payload: RawPayload): Promise<void> {
  // Decode feedback, aggregate reputation per agent.
  const feedbackByAgent: Record<string, OutFeedback[]> = {};
  const repByAgent = new Map<string, { sum: number; n: number }>();

  for (const f of payload.feedback) {
    const agentId = hexToBigInt(f.agent_id_hex).toString();
    const dec = decodeFeedback(f.raw_data);
    let value = 0;
    let valueDecimals = 0;
    let tag1 = "";
    let tag2 = "";
    let feedbackURI = "";
    let feedbackIndex = 0;
    if (dec) {
      value = Number(dec.value);
      valueDecimals = dec.valueDecimals;
      tag1 = dec.tag1;
      tag2 = dec.tag2;
      feedbackURI = dec.feedbackURI;
      feedbackIndex = Number(dec.feedbackIndex);
    }
    const score = valueDecimals > 0 ? value / Math.pow(10, valueDecimals) : value;
    const entry: OutFeedback = {
      agentId,
      client: f.client.toLowerCase(),
      feedbackIndex,
      value,
      valueDecimals,
      score,
      tag1,
      tag2,
      feedbackURI,
      isRevoked: false,
      txHash: f.transaction_hash ?? null,
      blockNumber: f.block_number ?? null,
      timestamp: f.ts ?? null,
    };
    (feedbackByAgent[agentId] ??= []).push(entry);
    const cur = repByAgent.get(agentId) ?? { sum: 0, n: 0 };
    cur.sum += score;
    cur.n += 1;
    repByAgent.set(agentId, cur);
  }

  // Build registration map (one agent may appear once; keep first/earliest).
  const regByAgent = new Map<string, RawReg>();
  for (const r of payload.registrations) {
    const agentId = hexToBigInt(r.agent_id_hex).toString();
    if (!regByAgent.has(agentId)) regByAgent.set(agentId, r);
  }

  // Demo-relevant ordering: agents WITH feedback first (by count desc), then a
  // sample of recent registrations to round out the explorer.
  const withFb = [...repByAgent.keys()].filter((id) => regByAgent.has(id));
  withFb.sort((a, b) => (repByAgent.get(b)!.n - repByAgent.get(a)!.n));

  const recentRegs = [...regByAgent.entries()]
    .filter(([id]) => !repByAgent.has(id))
    .sort((a, b) => (b[1].block_number ?? 0) - (a[1].block_number ?? 0))
    .map(([id]) => id);

  // Pick the agent set we will materialize: ALL with feedback + up to 40 recent.
  const selected = [...withFb, ...recentRegs.slice(0, 50)];

  // Enrich up to ~60 cards over HTTP (graceful), bounded concurrency.
  const ENRICH_CAP = 60;
  const toEnrich = selected.slice(0, ENRICH_CAP);
  const cardByAgent = new Map<string, AgentCard | null>();
  const CONC = 8;
  console.log(`Enriching up to ${toEnrich.length} agent cards over HTTP...`);
  for (let i = 0; i < toEnrich.length; i += CONC) {
    const slice = toEnrich.slice(i, i + CONC);
    await Promise.all(
      slice.map(async (agentId) => {
        const reg = regByAgent.get(agentId)!;
        const decoded = decodeRegistered(reg.raw_data);
        const uri = decoded?.agentURI ?? "";
        const card = uri ? await fetchAgentCard(uri) : null;
        cardByAgent.set(agentId, card);
      }),
    );
    process.stdout.write(`  ${Math.min(i + CONC, toEnrich.length)}/${toEnrich.length}\r`);
  }
  console.log("");

  const agents: OutAgent[] = selected.map((agentId) => {
    const reg = regByAgent.get(agentId)!;
    const decoded = decodeRegistered(reg.raw_data);
    const agentURI = decoded?.agentURI ?? "";
    const card = cardByAgent.get(agentId) ?? null;
    const rep = repByAgent.get(agentId);
    const service = card?.services?.[0];
    const serviceEndpoint = service?.endpoint ?? card?.serviceEndpoint ?? card?.endpoint ?? null;
    const priceUsdc =
      typeof card?.priceUsdc === "number"
        ? card.priceUsdc
        : typeof service?.priceUsdc === "number"
          ? service.priceUsdc
          : typeof service?.price === "number"
            ? service.price
            : null;
    // Skills: prefer explicit card.skills/capabilities; else derive from service
    // names + supportedTrusts; else from this agent's feedback tags.
    const fbTags = (feedbackByAgent[agentId] ?? []).flatMap((f) => [f.tag1, f.tag2]).filter(Boolean);
    const skillSet = new Set<string>([
      ...asStringArray(card?.skills),
      ...asStringArray(card?.capabilities),
      ...(card?.services ?? []).map((s) => s?.name ?? "").filter(Boolean),
      ...asStringArray(card?.supportedTrusts),
    ]);
    // Round out with up to 3 distinct feedback tags so filters always have signal.
    for (const t of fbTags) {
      if (skillSet.size >= 6) break;
      if (t.length <= 24) skillSet.add(t);
    }
    const skills = [...skillSet].slice(0, 8);
    const domainSet = new Set<string>(asStringArray(card?.domains));
    for (const t of fbTags) {
      const d = tagToDomain(t);
      if (d) domainSet.add(d);
    }
    const domains = [...domainSet].slice(0, 5);
    const x402Support =
      card?.x402Support === true ||
      card?.x402Support === "true" ||
      card?.x402support === true ||
      card?.x402support === "true";
    return {
      agentId,
      owner: reg.owner.toLowerCase(),
      agentURI,
      name: card?.name ?? "",
      description: card?.description ?? "",
      image: card?.image ?? null,
      skills,
      domains,
      x402Support,
      serviceEndpoint,
      payToWallet: card?.payToWallet ?? card?.agentWallet ?? reg.owner.toLowerCase(),
      priceUsdc,
      feedbackCount: rep?.n ?? 0,
      avgScore: rep ? rep.sum / rep.n : null,
      createdAtBlock: reg.block_number ?? null,
      createdAt: reg.ts ?? null,
      enriched: card != null,
    };
  });

  // Trim feedback to selected agents and keep a representative window (newest first).
  const selectedSet = new Set(selected);
  const trimmedFb: Record<string, OutFeedback[]> = {};
  for (const [agentId, list] of Object.entries(feedbackByAgent)) {
    if (!selectedSet.has(agentId)) continue;
    const sorted = [...list].sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0));
    trimmedFb[agentId] = sorted.slice(0, 24);
  }

  const out: OutCache = {
    pulledAt: new Date().toISOString(),
    totals: { registrations: payload.registrations.length, feedback: payload.feedback.length },
    agents,
    feedbackByAgent: trimmedFb,
    activity: deriveActivity(payload),
  };
  writeFileSync(OUT_CACHE, JSON.stringify(out, null, 2), "utf8");

  const enrichedN = agents.filter((a) => a.enriched).length;
  const withFbN = agents.filter((a) => a.feedbackCount > 0).length;
  console.log(`\nWrote ${OUT_CACHE}`);
  console.log(`  agents=${agents.length} (withFeedback=${withFbN}, enriched=${enrichedN})`);
  console.log(`  totals: registrations=${out.totals.registrations} feedback=${out.totals.feedback}`);
  console.log("\nSample agents (agentId, owner, name, feedbackCount):");
  for (const a of agents.slice(0, 8)) {
    console.log(`  ${a.agentId}\t${a.owner}\t${JSON.stringify(a.name).slice(0, 30)}\tfb=${a.feedbackCount}`);
  }
}

async function main(): Promise<void> {
  const enrichOnly = process.argv.includes("--enrich");
  let payload: RawPayload;
  if (enrichOnly) {
    if (!existsSync(RAW_CACHE)) throw new Error(`No raw cache at ${RAW_CACHE}; run without --enrich first`);
    console.log(`Re-enriching from ${RAW_CACHE} (no BigQuery query)`);
    payload = JSON.parse(readFileSync(RAW_CACHE, "utf8")) as RawPayload;
  } else if (existsSync(RAW_CACHE)) {
    console.log(`Raw cache already exists at ${RAW_CACHE}; reusing it (delete to re-query).`);
    payload = JSON.parse(readFileSync(RAW_CACHE, "utf8")) as RawPayload;
  } else {
    payload = await runQuery();
  }
  await enrich(payload);
}

main().catch((err) => {
  console.error("[pull-real-agents] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
