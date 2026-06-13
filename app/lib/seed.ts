/**
 * Temporary in-memory data source for the Pfand frontend.
 *
 * Everything here conforms to the canonical @pfand/shared domain model and is
 * shaped to mirror what the BigQuery index + Arc indexer will eventually emit,
 * so the API route handlers can swap this out for the real index without the
 * UI changing. Believable, not random: scores, prices and activity are
 * hand-tuned to read like a real ERC-8004 reputation graph.
 */

import type {
  Agent,
  ActivityBucket,
  FeedbackEntry,
  IndexStats,
  Job,
  ReputationSummary,
} from "@pfand/shared";

/** Deterministic 0..1 PRNG so the seed is stable across server restarts. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function addr(seed: string): string {
  // Stable pseudo-address derived from a label.
  let h = 0n;
  for (const c of seed) h = (h * 131n + BigInt(c.charCodeAt(0))) & ((1n << 160n) - 1n);
  return "0x" + h.toString(16).padStart(40, "0");
}

function tx(seed: string): string {
  let h = 0n;
  for (const c of seed) h = (h * 1099511628211n + BigInt(c.charCodeAt(0))) & ((1n << 256n) - 1n);
  return "0x" + h.toString(16).padStart(64, "0");
}

function isoDaysAgo(days: number): string {
  const ms = Date.UTC(2026, 5, 12) - days * 86_400_000;
  return new Date(ms).toISOString();
}

function reputation(count: number, avg: number | null): ReputationSummary {
  return {
    count,
    score: avg,
    // ERC-8004 feedback scores here live on a 0..100 scale already.
    scoreNormalized: avg === null ? null : Math.round(avg),
  };
}

interface Spec {
  id: number;
  network: Agent["network"];
  slug: string;
  name: string;
  description: string;
  skills: string[];
  domains: string[];
  x402: boolean;
  payable: boolean;
  price: number | null;
  fbCount: number;
  avg: number | null;
  ageDays: number;
}

const SPECS: Spec[] = [
  {
    id: 42,
    network: "arc",
    slug: "audit-sol",
    name: "AuditSol",
    description:
      "Autonomous Solidity & Vyper security auditor. Slither + symbolic execution + an LLM reviewer, returns a signed SARIF report and a severity-ranked findings list.",
    skills: ["solidity-audit", "static-analysis", "fuzzing"],
    domains: ["security", "smart-contracts"],
    x402: true,
    payable: true,
    price: 100,
    fbCount: 214,
    avg: 96,
    ageDays: 88,
  },
  {
    id: 7,
    network: "arc",
    slug: "labelforge",
    name: "LabelForge",
    description:
      "High-throughput data labeling agent for vision and NLP datasets. Consensus across three model passes with human-in-the-loop escalation on low agreement.",
    skills: ["data-labeling", "annotation", "quality-control"],
    domains: ["ml-ops", "data"],
    x402: true,
    payable: true,
    price: 4.5,
    fbCount: 1320,
    avg: 91,
    ageDays: 84,
  },
  {
    id: 311,
    network: "mainnet",
    slug: "raghound",
    name: "RagHound",
    description:
      "Retrieval-augmented question answering over your private corpus. Hybrid BM25 + dense retrieval, citation-grounded answers, refuses when context is insufficient.",
    skills: ["rag-retrieval", "embeddings", "qa"],
    domains: ["search", "knowledge"],
    x402: true,
    payable: false,
    price: 0.02,
    fbCount: 542,
    avg: 88,
    ageDays: 73,
  },
  {
    id: 128,
    network: "arc",
    slug: "pixelwright",
    name: "PixelWright",
    description:
      "Production image generation with brand-locked style adapters, deterministic seeds, and content-safety filtering. SDXL + custom LoRA stack.",
    skills: ["image-gen", "style-transfer", "upscaling"],
    domains: ["creative", "media"],
    x402: true,
    payable: true,
    price: 0.8,
    fbCount: 906,
    avg: 84,
    ageDays: 61,
  },
  {
    id: 64,
    network: "mainnet",
    slug: "summarist",
    name: "Summarist",
    description:
      "Long-document and meeting summarization with extractive grounding. Produces TL;DR, action items, and a faithfulness score per claim.",
    skills: ["summarization", "nlp", "transcription"],
    domains: ["productivity", "knowledge"],
    x402: false,
    payable: false,
    price: null,
    fbCount: 188,
    avg: 79,
    ageDays: 55,
  },
  {
    id: 999,
    network: "arc",
    slug: "chainwatch",
    name: "ChainWatch",
    description:
      "Real-time on-chain anomaly detection and wallet-risk scoring. Streams decoded events, flags MEV, drains and sanction hits with calibrated risk bands.",
    skills: ["onchain-analytics", "risk-scoring", "monitoring"],
    domains: ["security", "defi"],
    x402: true,
    payable: true,
    price: 12,
    fbCount: 431,
    avg: 93,
    ageDays: 49,
  },
  {
    id: 23,
    network: "mainnet",
    slug: "transmute",
    name: "Transmute",
    description:
      "Neural machine translation across 40 language pairs with terminology locking and glossary enforcement for legal and medical text.",
    skills: ["translation", "nlp", "localization"],
    domains: ["language", "compliance"],
    x402: false,
    payable: false,
    price: null,
    fbCount: 77,
    avg: 71,
    ageDays: 41,
  },
  {
    id: 256,
    network: "arc",
    slug: "voicewrite",
    name: "VoiceWrite",
    description:
      "Low-latency speech synthesis and cloning with consented voice prints. SSML control, 22 voices, sub-300ms first-byte streaming.",
    skills: ["speech-synthesis", "audio", "tts"],
    domains: ["media", "accessibility"],
    x402: true,
    payable: true,
    price: 0.15,
    fbCount: 612,
    avg: 86,
    ageDays: 33,
  },
  {
    id: 88,
    network: "arc",
    slug: "gasoptim",
    name: "GasOptim",
    description:
      "Gas optimization pass over your contracts: storage packing, calldata trimming, and assembly hot-paths with a before/after gas diff and a safety attestation.",
    skills: ["solidity-audit", "gas-optimization", "static-analysis"],
    domains: ["smart-contracts", "performance"],
    x402: true,
    payable: true,
    price: 35,
    fbCount: 142,
    avg: 90,
    ageDays: 22,
  },
  {
    id: 501,
    network: "mainnet",
    slug: "scribelegal",
    name: "ScribeLegal",
    description:
      "Contract review and clause extraction tuned on commercial agreements. Surfaces risky clauses, missing protections, and a redline draft.",
    skills: ["document-analysis", "nlp", "compliance"],
    domains: ["legal", "knowledge"],
    x402: false,
    payable: false,
    price: null,
    fbCount: 49,
    avg: 68,
    ageDays: 14,
  },
];

const TAGS1 = ["accuracy", "latency", "value", "reliability", "ux"];
const TAGS2 = ["verified-job", "repeat-client", "first-job", "escrowed", "x402"];

function buildFeedback(spec: Spec): FeedbackEntry[] {
  if (spec.avg === null || spec.fbCount === 0) return [];
  const r = rng(spec.id * 7919 + 13);
  const n = Math.min(spec.fbCount, 16); // keep a representative window
  const out: FeedbackEntry[] = [];
  for (let i = 0; i < n; i++) {
    // jitter around the agent average, clamped 0..100
    const jitter = (r() - 0.5) * 24;
    const raw = Math.max(0, Math.min(100, Math.round(spec.avg + jitter)));
    const revoked = r() < 0.05;
    const day = Math.round((i / n) * spec.ageDays);
    out.push({
      agentId: String(spec.id),
      network: spec.network,
      client: addr(`${spec.slug}-client-${i}`),
      feedbackIndex: i,
      value: raw * 100, // 2-decimal fixed point
      valueDecimals: 2,
      score: raw,
      tag1: TAGS1[Math.floor(r() * TAGS1.length)],
      tag2: TAGS2[Math.floor(r() * TAGS2.length)],
      feedbackURI: `ipfs://bafy${spec.slug}feedback${i}`,
      isRevoked: revoked,
      txHash: tx(`${spec.slug}-fb-${i}`),
      blockNumber: 21_400_000 + spec.id * 1000 + i,
      timestamp: isoDaysAgo(spec.ageDays - day),
    });
  }
  return out.reverse(); // newest first
}

function buildAgent(spec: Spec): Agent {
  const owner = addr(`${spec.slug}-owner`);
  return {
    agentId: String(spec.id),
    network: spec.network,
    owner,
    agentURI: `https://${spec.slug}.broker8004.eth/.well-known/agent.json`,
    name: spec.name,
    description: spec.description,
    image: null,
    skills: spec.skills,
    domains: spec.domains,
    x402Support: spec.x402,
    serviceEndpoint: spec.payable ? `https://api.${spec.slug}.xyz/v1/invoke` : null,
    payToWallet: spec.payable ? addr(`${spec.slug}-wallet`) : owner,
    ensName: `${spec.slug}.broker8004.eth`,
    payable: spec.payable,
    priceUsdc: spec.price,
    reputation: reputation(spec.fbCount, spec.avg),
    createdAtBlock: 21_000_000 + spec.id * 137,
    createdAt: isoDaysAgo(spec.ageDays),
  };
}

export const AGENTS: Agent[] = SPECS.map(buildAgent);

export const FEEDBACK: Record<string, FeedbackEntry[]> = Object.fromEntries(
  SPECS.map((s) => [String(s.id), buildFeedback(s)]),
);

export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.agentId === id);
}

export function getFeedback(id: string): FeedbackEntry[] {
  return FEEDBACK[id] ?? [];
}

/** All distinct skills, for filter UIs. */
export const ALL_SKILLS: string[] = Array.from(
  new Set(AGENTS.flatMap((a) => a.skills)),
).sort();

/* ----------------------------- Jobs ----------------------------- */

export const JOBS: Job[] = [
  {
    jobId: "1138",
    client: addr("demo-client"),
    serviceWallet: addr("audit-sol-wallet"),
    agentId: "42",
    fee: "100000000", // 100 USDC
    pfand: "10000000", // 10 USDC
    status: "settled",
    feedbackDeadline: Math.floor(Date.UTC(2026, 5, 9) / 1000),
    rebateClaimable: false,
    txHashes: {
      open: tx("job-1138-open"),
      complete: tx("job-1138-complete"),
      feedback: tx("job-1138-feedback"),
      claim: tx("job-1138-claim"),
    },
  },
  {
    jobId: "1142",
    client: addr("demo-client"),
    serviceWallet: addr("chainwatch-wallet"),
    agentId: "999",
    fee: "12000000",
    pfand: "1200000",
    status: "completed",
    feedbackDeadline: Math.floor(Date.UTC(2026, 5, 15) / 1000),
    rebateClaimable: true,
    txHashes: {
      open: tx("job-1142-open"),
      complete: tx("job-1142-complete"),
    },
  },
  {
    jobId: "1147",
    client: addr("acme-agent"),
    serviceWallet: addr("labelforge-wallet"),
    agentId: "7",
    fee: "4500000",
    pfand: "450000",
    status: "open",
    feedbackDeadline: Math.floor(Date.UTC(2026, 5, 18) / 1000),
    rebateClaimable: false,
    txHashes: {
      open: tx("job-1147-open"),
    },
  },
  {
    jobId: "1101",
    client: addr("ghost-agent"),
    serviceWallet: addr("pixelwright-wallet"),
    agentId: "128",
    fee: "800000",
    pfand: "80000",
    status: "forfeited",
    feedbackDeadline: Math.floor(Date.UTC(2026, 4, 28) / 1000),
    rebateClaimable: false,
    txHashes: {
      open: tx("job-1101-open"),
      complete: tx("job-1101-complete"),
    },
  },
];

/* --------------------------- Index stats --------------------------- */

const totalFeedback = AGENTS.reduce((s, a) => s + a.reputation.count, 0);

export const STATS: IndexStats = {
  agentsIndexed: AGENTS.length,
  feedbackSignals: totalFeedback,
  usdcEscrowed: 184_250,
  pfandReturnedPct: 87.4,
  byNetwork: {
    mainnet: AGENTS.filter((a) => a.network === "mainnet").length,
    arc: AGENTS.filter((a) => a.network === "arc").length,
  },
};

/* ----------------------------- Activity ----------------------------- */

/** ~90 days of registration + feedback activity with a believable rhythm. */
export const ACTIVITY: ActivityBucket[] = (() => {
  const r = rng(424242);
  const days = 90;
  const out: ActivityBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDaysAgo(i).slice(0, 10);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    const weekendDip = dow === 0 || dow === 6 ? 0.4 : 1;
    // gentle upward trend toward the present + bursts
    const trend = 0.5 + ((days - i) / days) * 1.2;
    const burst = r() < 0.08 ? 3 : 1;
    const feedback = Math.round(r() * 14 * trend * weekendDip * burst);
    const registrations = Math.round(r() * 3 * trend * weekendDip);
    out.push({ day: date, registrations, feedback });
  }
  return out;
})();
