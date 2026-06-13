/**
 * Single source of "agents with TrustRank" for the app.
 *
 * Runs the real EigenTrust engine (`@pfand/shared`) over the seed corpus and
 * caches the result for the process lifetime. This is the offline / no-creds
 * path; when Supabase is wired (see `lib/db.ts`), reads should prefer the live
 * DB and fall back to this. Keep the RETURN SHAPE stable — it is the contract
 * that `/api/network`, the broker, and the agent routes build against.
 */

import { scoreAgents, type TrustScore, type Agent } from "@pfand/shared";
import { AGENTS, FEEDBACK } from "./seed";

export interface ScoredData {
  /** Agents with `reputation.trustRank` / `scoresByTask` / `topTask` populated. */
  agents: Agent[];
  /** agentId-keyed scores: `${network}:${agentId}` → TrustScore. */
  scores: Map<string, TrustScore>;
  /** Distinct task categories present across all per-task scores, by volume desc. */
  tasks: string[];
  /** When these scores were computed (ISO). Live DB overrides this at integration. */
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
        scoresByTask: s.scoresByTask,
        distinctClients: s.distinctClients,
        topTask: s.topTask,
      },
    };
  });

  // Task list by total feedback volume across agents.
  const vol = new Map<string, number>();
  for (const s of scores.values())
    for (const t of s.scoresByTask)
      vol.set(t.tag, (vol.get(t.tag) ?? 0) + t.count);
  const tasks = [...vol.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

  _cache = {
    agents,
    scores,
    tasks,
    updatedAt: new Date().toISOString(),
  };
  return _cache;
}

/** Convenience: scored agents only. */
export function getScoredAgents(): Agent[] {
  return getScoredData().agents;
}
