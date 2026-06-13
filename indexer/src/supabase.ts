/**
 * Typed Supabase client + upsert helpers conforming to packages/shared/src/db.ts.
 *
 * Column names are snake_case in Postgres; the domain types are camelCase. The
 * helpers translate between the two and write the pgvector embedding string.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Agent, FeedbackEntry, Job, ActivityBucket } from "@pfand/shared";
import { embed, toPgVector } from "./embed.js";

export function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in indexer/.env (see .env.example).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Build the text we embed for hybrid search from an agent's metadata. */
export function agentSearchText(a: Agent): string {
  return [a.name, a.description, ...(a.skills ?? []), ...(a.domains ?? [])]
    .filter(Boolean)
    .join(" ");
}

function agentToRow(a: Agent, embedding: string) {
  return {
    network: a.network,
    agent_id: a.agentId,
    owner: a.owner.toLowerCase(),
    agent_uri: a.agentURI,
    name: a.name ?? "",
    description: a.description ?? "",
    image: a.image,
    skills: a.skills ?? [],
    domains: a.domains ?? [],
    x402_support: a.x402Support,
    service_endpoint: a.serviceEndpoint,
    pay_to_wallet: a.payToWallet,
    ens_name: a.ensName,
    payable: a.payable,
    price_usdc: a.priceUsdc,
    reputation_count: a.reputation.count,
    reputation_score: a.reputation.score,
    reputation_score_normalized: a.reputation.scoreNormalized,
    created_at_block: a.createdAtBlock,
    created_at: a.createdAt,
    embedding,
  };
}

/** Idempotent upsert of agents (computes embeddings). */
export async function upsertAgents(client: SupabaseClient, agents: Agent[]): Promise<number> {
  if (agents.length === 0) return 0;
  const rows = [];
  for (const a of agents) {
    const vec = await embed(agentSearchText(a));
    rows.push(agentToRow(a, toPgVector(vec)));
  }
  const { error } = await client.from("agents").upsert(rows, {
    onConflict: "network,agent_id",
  });
  if (error) throw new Error(`upsertAgents failed: ${error.message}`);
  return rows.length;
}

/** Idempotent upsert of feedback rows. */
export async function upsertFeedback(
  client: SupabaseClient,
  entries: FeedbackEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const rows = entries.map((f) => ({
    network: f.network,
    agent_id: f.agentId,
    client: f.client.toLowerCase(),
    feedback_index: f.feedbackIndex,
    value: f.value,
    value_decimals: f.valueDecimals,
    score: f.score,
    tag1: f.tag1 ?? "",
    tag2: f.tag2 ?? "",
    feedback_uri: f.feedbackURI ?? "",
    is_revoked: f.isRevoked,
    tx_hash: f.txHash,
    block_number: f.blockNumber,
    timestamp: f.timestamp,
  }));
  const { error } = await client.from("feedback").upsert(rows, {
    onConflict: "network,agent_id,client,feedback_index",
  });
  if (error) throw new Error(`upsertFeedback failed: ${error.message}`);
  return rows.length;
}

/** Idempotent upsert of jobs (Arc RebateEscrow). */
export async function upsertJobs(client: SupabaseClient, jobs: Job[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const rows = jobs.map((j) => ({
    job_id: j.jobId,
    client: j.client.toLowerCase(),
    service_wallet: j.serviceWallet.toLowerCase(),
    agent_id: j.agentId,
    fee: j.fee,
    pfand: j.pfand,
    status: j.status,
    feedback_deadline: j.feedbackDeadline,
    rebate_claimable: j.rebateClaimable,
    tx_open: j.txHashes.open ?? null,
    tx_complete: j.txHashes.complete ?? null,
    tx_feedback: j.txHashes.feedback ?? null,
    tx_claim: j.txHashes.claim ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client.from("jobs").upsert(rows, { onConflict: "job_id" });
  if (error) throw new Error(`upsertJobs failed: ${error.message}`);
  return rows.length;
}

/** Idempotent upsert of daily activity buckets. */
export async function upsertActivity(
  client: SupabaseClient,
  network: "mainnet" | "arc",
  buckets: ActivityBucket[],
): Promise<number> {
  if (buckets.length === 0) return 0;
  const rows = buckets.map((b) => ({
    network,
    day: b.day,
    registrations: b.registrations,
    feedback: b.feedback,
  }));
  const { error } = await client.from("activity").upsert(rows, {
    onConflict: "network,day",
  });
  if (error) throw new Error(`upsertActivity failed: ${error.message}`);
  return rows.length;
}
