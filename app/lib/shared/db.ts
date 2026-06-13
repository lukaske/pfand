/**
 * Canonical domain model shared by the indexer, API, agents, and UI.
 * This is the interface contract between parallel workstreams — keep it stable.
 */

export type AgentNetwork = "mainnet" | "arc";

/** Per-task-category trust score for an agent (0–100 percentile within that task). */
export interface TaskScore {
  tag: string;
  score: number;
  count: number;
}

export interface ReputationSummary {
  /** Number of non-revoked feedback entries. */
  count: number;
  /** Aggregated/average score as a human float (already divided by 10^decimals). */
  score: number | null;
  /** 0–100 normalized score for sorting/badges, null if no feedback. */
  scoreNormalized: number | null;
  /** EigenTrust percentile rank (0–100) among all rated agents, null if unrated.
   *  Optional so legacy/seed objects compile before the scoring pipeline fills it in. */
  trustRank?: number | null;
  /** Raw EigenTrust eigenvector value (tiny), for bubble area; null if unrated. */
  trustRankRaw?: number | null;
  /** Per-task trust scores, sorted desc by score. */
  scoresByTask?: TaskScore[];
  /** Count of unique clients that left non-revoked feedback. */
  distinctClients?: number;
  /** Highest-scoring task tag, or null if unrated. */
  topTask?: string | null;
}

export interface Agent {
  agentId: string; // uint256 as string
  network: AgentNetwork;
  owner: string; // 0x address
  agentURI: string;
  name: string;
  description: string;
  image: string | null;
  skills: string[];
  domains: string[];
  x402Support: boolean;
  /** Service endpoint from the agent registration file, if any. */
  serviceEndpoint: string | null;
  /** Wallet that receives payments (ERC-8004 agentWallet or owner). */
  payToWallet: string | null;
  /** <name>.agent8004.eth if a subname has been issued. */
  ensName: string | null;
  /** True if the agent is live + payable on Arc in this demo. */
  payable: boolean;
  /** Headline price in USDC (human units) if advertised. */
  priceUsdc: number | null;
  reputation: ReputationSummary;
  createdAtBlock: number | null;
  createdAt: string | null; // ISO
}

export interface FeedbackEntry {
  agentId: string;
  network: AgentNetwork;
  client: string;
  feedbackIndex: number;
  value: number; // raw signed fixed-point
  valueDecimals: number;
  score: number; // value / 10^valueDecimals
  tag1: string;
  tag2: string;
  feedbackURI: string;
  isRevoked: boolean;
  txHash: string | null;
  blockNumber: number | null;
  timestamp: string | null; // ISO
}

export type JobStatus = "open" | "completed" | "settled" | "forfeited";

/** A Pfand job on Arc (RebateEscrow). */
export interface Job {
  jobId: string;
  client: string;
  serviceWallet: string;
  agentId: string;
  fee: string; // USDC 6-dec base units as string
  pfand: string; // USDC 6-dec base units as string
  status: JobStatus;
  feedbackDeadline: number; // unix seconds
  rebateClaimable: boolean;
  txHashes: {
    open?: string;
    complete?: string;
    feedback?: string;
    claim?: string;
  };
}

export interface AgentSearchResult extends Agent {
  /** Why this agent matched (filters that hit + semantic note). */
  matchReason: string | null;
  /** 0–1 semantic similarity within the filtered set, if hybrid search ran. */
  semanticScore: number | null;
  /** EigenTrust percentile rank (0–100) among all rated agents, null if unrated. */
  trustRank?: number | null;
  /** Task-specific trust score (0–100) for the searched task, null if N/A. */
  taskScore?: number | null;
}

/** Parsed structured filters the NL search extracts from a query. */
export interface SearchFilters {
  skills: string[];
  maxPriceUsdc: number | null;
  minScore: number | null;
  requiresX402: boolean | null;
  payableOnly: boolean | null;
  freeText: string | null;
}

export interface IndexStats {
  agentsIndexed: number;
  feedbackSignals: number;
  usdcEscrowed: number; // human USDC
  pfandReturnedPct: number | null;
  byNetwork: Record<AgentNetwork, number>;
}

/** A point in an agent activity heatmap (registrations or feedback over time). */
export interface ActivityBucket {
  day: string; // YYYY-MM-DD
  registrations: number;
  feedback: number;
}
