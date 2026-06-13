/**
 * Lightweight NL → SearchFilters extraction + hybrid ranking over the seed.
 *
 * This is a deterministic stand-in for the BigQuery hybrid (BM25 + vector)
 * search. The shapes it returns (SearchFilters, AgentSearchResult) are the real
 * contract, so the page never learns this was keyword rules under the hood.
 */

import type { Agent, AgentSearchResult, SearchFilters } from "@pfand/shared";
import { ALL_SKILLS } from "./seed";

/** Maps loose user vocabulary to the canonical skill slugs in the index. */
const SKILL_SYNONYMS: Record<string, string[]> = {
  "solidity-audit": ["solidity", "audit", "auditor", "smart contract", "security review", "vyper"],
  "gas-optimization": ["gas", "optimize", "optimization", "cheap gas"],
  "static-analysis": ["slither", "static analysis", "lint"],
  fuzzing: ["fuzz", "fuzzing"],
  "data-labeling": ["label", "labeling", "annotation", "annotate", "dataset"],
  "rag-retrieval": ["rag", "retrieval", "retrieve", "knowledge base"],
  embeddings: ["embedding", "embeddings", "vector"],
  qa: ["question answering", "q&a", "qa"],
  "image-gen": ["image", "images", "image gen", "art", "picture", "render"],
  "style-transfer": ["style"],
  summarization: ["summarize", "summary", "summarization", "tl;dr", "tldr"],
  transcription: ["transcribe", "transcription"],
  translation: ["translate", "translation", "translator", "localize"],
  "speech-synthesis": ["voice", "speech", "tts", "text to speech", "narrate"],
  "onchain-analytics": ["onchain", "on-chain", "analytics", "monitor", "monitoring"],
  "risk-scoring": ["risk", "fraud", "anomaly"],
  "document-analysis": ["document", "contract review", "clause", "redline"],
  compliance: ["compliance", "legal", "regulatory"],
};

const PRICE_RE = /(?:under|below|less than|cheaper than|max|<)\s*\$?\s*(\d+(?:\.\d+)?)/i;

export function extractFilters(query: string): SearchFilters {
  const q = query.toLowerCase();
  const skills = new Set<string>();

  for (const skill of ALL_SKILLS) {
    if (q.includes(skill)) skills.add(skill);
  }
  for (const [skill, syns] of Object.entries(SKILL_SYNONYMS)) {
    if (syns.some((s) => q.includes(s)) && ALL_SKILLS.includes(skill)) {
      skills.add(skill);
    }
  }

  // Price intent: explicit "under $X", or soft "cheap/affordable/budget".
  let maxPriceUsdc: number | null = null;
  const m = q.match(PRICE_RE);
  if (m) maxPriceUsdc = Number(m[1]);
  else if (/\b(cheap|affordable|budget|low ?cost|inexpensive)\b/.test(q)) maxPriceUsdc = 10;

  // Quality intent.
  let minScore: number | null = null;
  if (/\b(reliable|trusted|trustworthy|high[- ]?quality|reputable|best|top|proven)\b/.test(q)) {
    minScore = 85;
  }

  const requiresX402 = /\bx402\b|gas[- ]?free|nanopayment|micropayment/.test(q) ? true : null;
  const payableOnly = /\b(hire|pay|payable|buy|purchase|on arc|live)\b/.test(q) ? true : null;

  return {
    skills: Array.from(skills),
    maxPriceUsdc,
    minScore,
    requiresX402,
    payableOnly,
    freeText: query.trim() || null,
  };
}

/** Apply hard filters, then score + sort. Returns AgentSearchResult[]. */
export function rankAgents(agents: Agent[], filters: SearchFilters): AgentSearchResult[] {
  const candidates = agents.filter((a) => {
    if (filters.requiresX402 && !a.x402Support) return false;
    if (filters.payableOnly && !a.payable) return false;
    if (
      filters.maxPriceUsdc != null &&
      a.priceUsdc != null &&
      a.priceUsdc > filters.maxPriceUsdc
    ) {
      return false;
    }
    if (
      filters.minScore != null &&
      (a.reputation.scoreNormalized == null ||
        a.reputation.scoreNormalized < filters.minScore)
    ) {
      return false;
    }
    return true;
  });

  const scored = candidates.map((a) => {
    let semantic = 0.4; // baseline relevance
    const reasons: string[] = [];

    const skillHits = filters.skills.filter((s) => a.skills.includes(s));
    if (skillHits.length) {
      semantic += 0.28 * Math.min(skillHits.length, 2);
      reasons.push(`matches ${skillHits.join(", ")}`);
    } else if (filters.skills.length) {
      // partial: shares a domain word
      semantic -= 0.05;
    }

    if (filters.minScore != null && a.reputation.scoreNormalized != null) {
      semantic += (a.reputation.scoreNormalized - filters.minScore) / 200;
      reasons.push(`reputation ${a.reputation.scoreNormalized}/100`);
    }
    if (filters.maxPriceUsdc != null && a.priceUsdc != null) {
      reasons.push(`${a.priceUsdc} USDC ≤ ${filters.maxPriceUsdc}`);
    }
    if (filters.requiresX402 && a.x402Support) reasons.push("accepts x402");
    if (filters.payableOnly && a.payable) reasons.push("live on Arc");

    // free-text token overlap with name/description
    if (filters.freeText) {
      const tokens = filters.freeText.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
      const hay = (a.name + " " + a.description).toLowerCase();
      const overlap = tokens.filter((t) => hay.includes(t)).length;
      semantic += Math.min(overlap, 4) * 0.04;
    }

    semantic = Math.max(0.05, Math.min(0.99, semantic));

    return {
      ...a,
      matchReason: reasons.length ? reasons.join(" · ") : "general relevance",
      semanticScore: Number(semantic.toFixed(2)),
    } satisfies AgentSearchResult;
  });

  scored.sort((a, b) => (b.semanticScore ?? 0) - (a.semanticScore ?? 0));
  return scored;
}
