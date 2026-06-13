/**
 * Single source of "agents with TrustRank" for the app (v2).
 *
 * Runs the real EigenTrust engine (`@pfand/shared`) over the seed corpus and
 * caches the result for the process lifetime. This is the offline / no-creds
 * path; when Supabase is wired (see `lib/db.ts`), reads prefer the live DB and
 * fall back to this. Keep the RETURN SHAPE stable — it is the contract that
 * `/api/network`, the broker, and the agent routes build against.
 *
 * v2: scores are sign-based reviews + payment edges over a HUMAN-rooted graph.
 * Each agent carries trustRank, evidence (distinct reviews / payments), a
 * distrust flag, and top free-text tags (side metadata only).
 */

import { scoreAgents, type TrustScore, type Agent } from "@pfand/shared";
import { AGENTS, FEEDBACK } from "./seed";

export interface ScoredData {
  /** Agents with reputation.trustRank / evidence / distrustFlag / tags populated. */
  agents: Agent[];
  /** Keyed by `${network}:${agentId}` → TrustScore. */
  scores: Map<string, TrustScore>;
  /** Distinct tag labels present, by frequency desc (for filter chips). */
  tasks: string[];
  /** When these scores were computed (ISO). Live DB overrides at integration. */
  updatedAt: string;
}

let _cache: ScoredData | null = null;

/** Flat feedback list across all agents (graph edges come from this). */
export function allFeedback() {
  return Object.values(FEEDBACK).flat();
}

export function getScoredData(): ScoredData {
  if (_cache) return _cache;

  const feedback = allFeedback();
  // Seed corpus has no on-chain payment data — reviews-only here; the live DB
  // path (lib/db.ts) supplies real payment edges.
  const scores = scoreAgents(feedback, AGENTS, {
    nowMs: Date.now(),
    halfLifeDays: 180,
    pfandBoost: 3,
  });

  const agents = AGENTS.map((a) => {
    const s = scores.get(`${a.network}:${a.agentId}`);
    if (!s) return a;
    return {
      ...a,
      reputation: {
        ...a.reputation,
        trustRank: s.trustRank,
        trustRankRaw: s.trustRankRaw,
        topTask: s.topTask,
        evidence: s.evidence,
        distrustFlag: s.distrustFlag,
        tags: s.tags,
        distinctClients: s.evidence.distinctReviews, // back-compat
      },
    };
  });

  // Tag labels by total frequency across agents (for filter chips / "known for").
  const vol = new Map<string, number>();
  for (const s of scores.values())
    for (const t of s.tags) vol.set(t.tag, (vol.get(t.tag) ?? 0) + t.count);
  const tasks = [...vol.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

  _cache = { agents, scores, tasks, updatedAt: new Date().toISOString() };
  return _cache;
}

/** Convenience: scored agents only. */
export function getScoredAgents(): Agent[] {
  return getScoredData().agents;
}
