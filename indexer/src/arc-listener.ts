/**
 * Arc RPC listener: indexes our own ERC-8004 + RebateEscrow deployment on Arc
 * Testnet into Supabase. Backfills historical logs via getLogs, then live-watches
 * for new events. Upserts agents / feedback / jobs. Idempotent.
 *
 * Usage:
 *   tsx src/arc-listener.ts             # backfill + watch (needs creds)
 *   tsx src/arc-listener.ts --once      # backfill only, then exit
 *   tsx src/arc-listener.ts --dry-run   # print config + addresses, no creds
 */
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import {
  arcTestnet,
  loadArcDeployment,
  identityRegistryAbi,
  reputationRegistryAbi,
  rebateEscrowAbi,
  type Agent,
  type FeedbackEntry,
  type Job,
  type JobStatus,
} from "@pfand/shared";

loadEnv();

const isDryRun = process.argv.includes("--dry-run");
const isOnce = process.argv.includes("--once");

// Event fragments we watch (signatures match @pfand/shared ABIs).
const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const NEW_FEEDBACK = parseAbiItem(
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
);
const JOB_OPENED = parseAbiItem(
  "event JobOpened(uint256 indexed jobId, address indexed client, uint256 indexed agentId, address serviceWallet, uint256 fee, uint256 pfand, uint64 feedbackDeadline)",
);
const JOB_COMPLETED = parseAbiItem(
  "event JobCompleted(uint256 indexed jobId, address indexed serviceWallet, uint256 fee)",
);
const REBATE_CLAIMED = parseAbiItem(
  "event RebateClaimed(uint256 indexed jobId, address indexed client, uint256 pfand, uint64 feedbackIndex)",
);
const REBATE_FORFEITED = parseAbiItem(
  "event RebateForfeited(uint256 indexed jobId, address indexed treasury, uint256 pfand)",
);

void identityRegistryAbi;
void reputationRegistryAbi;
void rebateEscrowAbi;

function makeClient(): PublicClient {
  const url = process.env.ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0];
  return createPublicClient({ chain: arcTestnet, transport: http(url) });
}

// ---- agent card fetch (shared logic kept local to avoid cross-imports) -------
async function fetchCard(uri: string): Promise<Record<string, any> | null> {
  try {
    const prefix = "data:application/json;base64,";
    if (uri.startsWith(prefix)) {
      return JSON.parse(
        Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"),
      ) as Record<string, any>;
    }
    let url = uri;
    if (url.startsWith("ipfs://")) {
      url = (process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/") + url.slice(7);
    }
    if (!/^https?:\/\//.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : (x as any)?.name ?? "")).filter(Boolean)
    : [];
}

async function buildAgent(
  agentId: bigint,
  owner: string,
  agentURI: string,
  block: bigint | null,
): Promise<Agent> {
  const card = await fetchCard(agentURI);
  const service = card?.services?.[0];
  return {
    agentId: agentId.toString(),
    network: "arc",
    owner: owner.toLowerCase(),
    agentURI,
    name: card?.name ?? "",
    description: card?.description ?? "",
    image: card?.image ?? null,
    skills: asStrArr(card?.skills),
    domains: asStrArr(card?.domains),
    x402Support: card?.x402Support === true,
    serviceEndpoint: service?.endpoint ?? card?.serviceEndpoint ?? card?.endpoint ?? null,
    payToWallet: card?.payToWallet ?? card?.agentWallet ?? owner.toLowerCase(),
    ensName: null,
    payable: true, // Arc agents in this demo are live + payable
    priceUsdc:
      typeof card?.priceUsdc === "number"
        ? card.priceUsdc
        : typeof service?.priceUsdc === "number"
          ? service.priceUsdc
          : typeof service?.price === "number"
            ? service.price
            : null,
    reputation: { count: 0, score: null, scoreNormalized: null },
    createdAtBlock: block != null ? Number(block) : null,
    createdAt: null,
  };
}

type Decoded<TArgs> = Log & { args: TArgs };

async function run(): Promise<void> {
  const dep = loadArcDeployment(process.env as Record<string, string | undefined>);
  const client = makeClient();
  const { getSupabase, upsertAgents, upsertFeedback, upsertJobs } = await import(
    "./supabase.js"
  );
  const supabase = getSupabase();

  const fromBlock = BigInt(process.env.ARC_FROM_BLOCK ?? "0");

  // ---- Backfill -------------------------------------------------------------
  console.log(`[arc] backfilling from block ${fromBlock}...`);

  const regLogs = (await client.getLogs({
    address: dep.identityRegistry,
    event: REGISTERED,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{ agentId: bigint; agentURI: string; owner: string }>[];

  const agents: Agent[] = [];
  for (const log of regLogs) {
    agents.push(
      await buildAgent(log.args.agentId, log.args.owner, log.args.agentURI, log.blockNumber),
    );
  }

  const fbLogs = (await client.getLogs({
    address: dep.reputationRegistry,
    event: NEW_FEEDBACK,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{
    agentId: bigint;
    clientAddress: string;
    feedbackIndex: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    feedbackURI: string;
  }>[];

  const feedback: FeedbackEntry[] = fbLogs.map((log) => feedbackFromLog(log));
  applyReputation(agents, feedback);

  const jobLogs = (await client.getLogs({
    address: dep.rebateEscrow,
    event: JOB_OPENED,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{
    jobId: bigint;
    client: string;
    agentId: bigint;
    serviceWallet: string;
    fee: bigint;
    pfand: bigint;
    feedbackDeadline: bigint;
  }>[];
  const jobs = new Map<string, Job>();
  for (const log of jobLogs) jobs.set(log.args.jobId.toString(), jobFromOpened(log));

  // apply status-changing job events from backfill
  await applyJobStatusLogs(client, dep.rebateEscrow, fromBlock, jobs);

  console.log(
    `[arc] backfill: agents=${agents.length} feedback=${feedback.length} jobs=${jobs.size}`,
  );
  await upsertAgents(supabase, agents);
  await upsertFeedback(supabase, feedback);
  await upsertJobs(supabase, [...jobs.values()]);

  if (isOnce) {
    console.log("[arc] --once set, exiting after backfill.");
    return;
  }

  // ---- Live watch -----------------------------------------------------------
  console.log("[arc] watching for new events (Ctrl-C to stop)...");

  client.watchEvent({
    address: dep.identityRegistry,
    event: REGISTERED,
    onLogs: async (logs) => {
      for (const log of logs as typeof regLogs) {
        const a = await buildAgent(
          log.args.agentId,
          log.args.owner,
          log.args.agentURI,
          log.blockNumber,
        );
        await upsertAgents(supabase, [a]);
        console.log(`[arc] +agent ${a.agentId}`);
      }
    },
  });

  client.watchEvent({
    address: dep.reputationRegistry,
    event: NEW_FEEDBACK,
    onLogs: async (logs) => {
      const fb = (logs as typeof fbLogs).map(feedbackFromLog);
      await upsertFeedback(supabase, fb);
      // refresh affected agents' reputation summaries
      console.log(`[arc] +feedback x${fb.length}`);
    },
  });

  const onJobChange = async () => {
    const refreshed = new Map<string, Job>();
    const opened = (await client.getLogs({
      address: dep.rebateEscrow,
      event: JOB_OPENED,
      fromBlock,
      toBlock: "latest",
    })) as typeof jobLogs;
    for (const log of opened) refreshed.set(log.args.jobId.toString(), jobFromOpened(log));
    await applyJobStatusLogs(client, dep.rebateEscrow, fromBlock, refreshed);
    await upsertJobs(supabase, [...refreshed.values()]);
    console.log(`[arc] jobs refreshed (${refreshed.size})`);
  };
  client.watchEvent({ address: dep.rebateEscrow, event: JOB_OPENED, onLogs: onJobChange });
  client.watchEvent({ address: dep.rebateEscrow, event: JOB_COMPLETED, onLogs: onJobChange });
  client.watchEvent({ address: dep.rebateEscrow, event: REBATE_CLAIMED, onLogs: onJobChange });
  client.watchEvent({ address: dep.rebateEscrow, event: REBATE_FORFEITED, onLogs: onJobChange });
}

// ---- helpers ----------------------------------------------------------------

function feedbackFromLog(log: Decoded<{
  agentId: bigint;
  clientAddress: string;
  feedbackIndex: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  feedbackURI: string;
}>): FeedbackEntry {
  const value = Number(log.args.value);
  const decimals = Number(log.args.valueDecimals);
  return {
    agentId: log.args.agentId.toString(),
    network: "arc",
    client: log.args.clientAddress.toLowerCase(),
    feedbackIndex: Number(log.args.feedbackIndex),
    value,
    valueDecimals: decimals,
    score: value / Math.pow(10, decimals),
    tag1: log.args.tag1 ?? "",
    tag2: log.args.tag2 ?? "",
    feedbackURI: log.args.feedbackURI ?? "",
    isRevoked: false,
    txHash: log.transactionHash ?? null,
    blockNumber: log.blockNumber != null ? Number(log.blockNumber) : null,
    timestamp: null,
  };
}

function jobFromOpened(log: Decoded<{
  jobId: bigint;
  client: string;
  agentId: bigint;
  serviceWallet: string;
  fee: bigint;
  pfand: bigint;
  feedbackDeadline: bigint;
}>): Job {
  return {
    jobId: log.args.jobId.toString(),
    client: log.args.client.toLowerCase(),
    serviceWallet: log.args.serviceWallet.toLowerCase(),
    agentId: log.args.agentId.toString(),
    fee: log.args.fee.toString(),
    pfand: log.args.pfand.toString(),
    status: "open" as JobStatus,
    feedbackDeadline: Number(log.args.feedbackDeadline),
    rebateClaimable: false,
    txHashes: { open: log.transactionHash ?? undefined },
  };
}

/** Apply JobCompleted / RebateClaimed / RebateForfeited to a job map in place. */
async function applyJobStatusLogs(
  client: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint,
  jobs: Map<string, Job>,
): Promise<void> {
  const completed = (await client.getLogs({
    address,
    event: JOB_COMPLETED,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{ jobId: bigint }>[];
  for (const log of completed) {
    const j = jobs.get(log.args.jobId.toString());
    if (j) {
      j.status = "completed";
      j.rebateClaimable = true;
      j.txHashes.complete = log.transactionHash ?? undefined;
    }
  }
  const claimed = (await client.getLogs({
    address,
    event: REBATE_CLAIMED,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{ jobId: bigint }>[];
  for (const log of claimed) {
    const j = jobs.get(log.args.jobId.toString());
    if (j) {
      j.status = "settled";
      j.rebateClaimable = false;
      j.txHashes.claim = log.transactionHash ?? undefined;
    }
  }
  const forfeited = (await client.getLogs({
    address,
    event: REBATE_FORFEITED,
    fromBlock,
    toBlock: "latest",
  })) as Decoded<{ jobId: bigint }>[];
  for (const log of forfeited) {
    const j = jobs.get(log.args.jobId.toString());
    if (j) {
      j.status = "forfeited";
      j.rebateClaimable = false;
    }
  }
}

/** Compute per-agent reputation from feedback and attach to agents in place. */
function applyReputation(agents: Agent[], feedback: FeedbackEntry[]): void {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const f of feedback) {
    if (f.isRevoked) continue;
    const c = acc.get(f.agentId) ?? { sum: 0, n: 0 };
    c.sum += f.score;
    c.n += 1;
    acc.set(f.agentId, c);
  }
  for (const a of agents) {
    const c = acc.get(a.agentId);
    if (!c || c.n === 0) continue;
    const avg = c.sum / c.n;
    a.reputation = {
      count: c.n,
      score: avg,
      scoreNormalized: Math.max(0, Math.min(100, avg)),
    };
  }
}

function dryRun(): void {
  console.log("=== Pfand Arc listener — DRY RUN (no creds used) ===\n");
  console.log(`Chain:      ${arcTestnet.name} (id ${arcTestnet.id})`);
  console.log(`RPC:        ${process.env.ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0]}`);
  console.log("Watched contracts (from ARC_* env, required at runtime):");
  console.log("  ARC_IDENTITY_REGISTRY   -> Registered");
  console.log("  ARC_REPUTATION_REGISTRY -> NewFeedback");
  console.log("  ARC_REBATE_ESCROW       -> JobOpened/JobCompleted/RebateClaimed/RebateForfeited");
  console.log("\nWrites: agents (network='arc'), feedback, jobs -> Supabase.");
  console.log("=== End dry run. Provide ARC_* + Supabase creds to execute. ===");
}

(isDryRun ? Promise.resolve(dryRun()) : run()).catch((err) => {
  console.error("[arc] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
