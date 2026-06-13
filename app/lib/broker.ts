/**
 * Broker8004 (agent8004.eth) — the natural-language broker.
 *
 * Flow:
 *   1. Parse intent. Prefer Vertex/Gemini (`extractIntentLLM`); fall back to the
 *      deterministic `extractFilters` from lib/search. The source is reported so
 *      the UI can show how the query was understood.
 *   2. Hard-filter the scored corpus by reusing `rankAgents` (the single source
 *      of truth for filter semantics).
 *   3. RE-ORDER by per-task TrustRank: an agent's score within the detected task,
 *      falling back to its overall TrustRank.
 *   4. Attach a one-line rationale to the top results (Gemini when configured,
 *      templated otherwise).
 *
 * Pure data comes from `lib/scored` (real EigenTrust over the seed); the LLM is
 * always optional and never required for a correct response.
 */

import type {
  Agent,
  AgentSearchResult,
  SearchFilters,
} from "@pfand/shared";
import { extractFilters, rankAgents } from "@/lib/search";
import { getScoredAgents, getScoredData } from "@/lib/scored";
import { extractIntentLLM, rationale, type BrokerIntent } from "@/lib/llm";
import type { SearchResponse } from "@/lib/api";

/** How many top results get a (possibly LLM-generated) rationale. */
const RATIONALE_TOP_N = 5;

/** Map an LLM BrokerIntent onto the canonical SearchFilters shape. */
function intentToFilters(intent: BrokerIntent, query: string): SearchFilters {
  return {
    skills: intent.skills ?? [],
    maxPriceUsdc: intent.maxPriceUsdc,
    minScore: intent.minTrust, // minTrust → minScore
    requiresX402: intent.requiresX402,
    payableOnly: intent.payableOnly,
    freeText: intent.freeText ?? query.trim() ?? null,
  };
}

/**
 * Best-effort match of deterministic filters to one of the known task tags.
 * Used only on the fallback path (the LLM names the task directly).
 */
function inferTask(filters: SearchFilters, tasks: string[]): string | null {
  if (!tasks.length) return null;
  const hay = [
    ...filters.skills,
    filters.freeText ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (!hay.trim()) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const tag of tasks) {
    // tags are kebab; match on the tag and on its individual words.
    const words = tag.split("-").filter((w) => w.length > 2);
    let score = 0;
    if (hay.includes(tag)) score += 3;
    for (const w of words) if (hay.includes(w)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = tag;
    }
  }
  return bestScore > 0 ? best : null;
}

/** The per-task score for `tag`, or null if the agent has none. */
function taskScoreFor(agent: Agent, tag: string | null): number | null {
  if (!tag) return null;
  const found = agent.reputation.scoresByTask?.find((t) => t.tag === tag);
  return found ? found.score : null;
}

/** Sort key: per-task score when a task is detected, else overall TrustRank. */
function orderKey(agent: Agent, detectedTask: string | null): number {
  const perTask = taskScoreFor(agent, detectedTask);
  if (perTask != null) return perTask;
  return agent.reputation.trustRank ?? -1;
}

/** Templated, deterministic rationale used when the LLM is unavailable. */
function templatedReason(
  agent: AgentSearchResult,
  detectedTask: string | null,
  taskScore: number | null,
): string {
  const trust = agent.reputation.trustRank;
  if (detectedTask && taskScore != null) {
    return `Top-ranked for ${detectedTask} · TrustRank ${Math.round(taskScore)}`;
  }
  if (trust != null) {
    return `TrustRank ${Math.round(trust)}${agent.reputation.topTask ? ` · best at ${agent.reputation.topTask}` : ""}`;
  }
  return agent.matchReason ?? "general relevance";
}

export async function broker(query: string): Promise<SearchResponse> {
  const q = (query ?? "").toString();
  const { tasks } = getScoredData();

  // 1. Intent → filters + detectedTask + source.
  let filters: SearchFilters;
  let detectedTask: string | null;
  let source: "vertex" | "deterministic";

  const intent = await extractIntentLLM(q);
  if (intent) {
    filters = intentToFilters(intent, q);
    detectedTask = intent.taskTag;
    source = "vertex";
    // If the LLM named a task that isn't a real category, soft-match it.
    if (detectedTask && !tasks.includes(detectedTask)) {
      detectedTask = inferTask(filters, tasks) ?? detectedTask;
    }
  } else {
    filters = extractFilters(q);
    detectedTask = inferTask(filters, tasks);
    source = "deterministic";
  }

  // 2. Hard filters + base ranking over the scored corpus.
  const candidates = getScoredAgents();
  const ranked = rankAgents(candidates, filters);

  // 3. Re-order by per-task TrustRank (stable on ties via base semantic order).
  const reordered = [...ranked].sort(
    (a, b) => orderKey(b, detectedTask) - orderKey(a, detectedTask),
  );

  // Annotate every result with trust/task fields + a TrustRank-aware reason.
  const results: AgentSearchResult[] = reordered.map((r) => {
    const taskScore = taskScoreFor(r, detectedTask);
    const trustRank = r.reputation.trustRank ?? null;
    const trustNote =
      detectedTask && taskScore != null
        ? `Top-ranked for ${detectedTask} · TrustRank ${Math.round(taskScore)}`
        : trustRank != null
          ? `TrustRank ${Math.round(trustRank)}`
          : null;
    const matchReason =
      trustNote && r.matchReason
        ? `${trustNote} · ${r.matchReason}`
        : trustNote ?? r.matchReason;

    return {
      ...r,
      trustRank,
      taskScore,
      matchReason,
    };
  });

  // 4. Top-N rationale (Gemini when configured, templated fallback otherwise).
  const top = results.slice(0, RATIONALE_TOP_N);
  const rationales = await Promise.all(
    top.map((r) => rationale(q, r).catch(() => null)),
  );
  for (let i = 0; i < top.length; i++) {
    const r = results[i];
    const llmLine = rationales[i];
    if (llmLine) {
      r.matchReason = llmLine;
    } else if (!r.matchReason) {
      r.matchReason = templatedReason(
        r,
        detectedTask,
        taskScoreFor(r, detectedTask),
      );
    }
  }

  return { query: q, filters, results, detectedTask, source };
}
