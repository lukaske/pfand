"use client";

/**
 * Typed fetchers + React Query hooks over the Pfand API routes.
 * The QueryClient is provided by app/providers.tsx.
 */

import {
  useMutation,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Agent,
  AgentSearchResult,
  ActivityBucket,
  FeedbackEntry,
  IndexStats,
  SearchFilters,
} from "@pfand/shared";
import type { DemoRunResponse } from "./demo-types";

export interface AgentFilters {
  network?: "all" | "mainnet" | "arc";
  skill?: string;
  x402?: boolean;
  payable?: boolean;
  sort?: "score" | "price" | "feedback" | "recent";
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function agentsQueryString(f: AgentFilters): string {
  const p = new URLSearchParams();
  if (f.network && f.network !== "all") p.set("network", f.network);
  if (f.skill && f.skill !== "all") p.set("skill", f.skill);
  if (f.x402) p.set("x402", "true");
  if (f.payable) p.set("payable", "true");
  if (f.sort) p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/* --------------------------------- hooks --------------------------------- */

export function useAgents(
  filters: AgentFilters = {},
): UseQueryResult<{ agents: Agent[]; total: number }> {
  return useQuery({
    queryKey: ["agents", filters],
    queryFn: () =>
      getJSON<{ agents: Agent[]; total: number }>(
        `/api/agents${agentsQueryString(filters)}`,
      ),
  });
}

export function useAgent(
  id: string | null | undefined,
): UseQueryResult<{ agent: Agent; feedback: FeedbackEntry[] }> {
  return useQuery({
    queryKey: ["agent", id],
    enabled: !!id,
    queryFn: () =>
      getJSON<{ agent: Agent; feedback: FeedbackEntry[] }>(
        `/api/agents/${id}`,
      ),
  });
}

export interface SearchResponse {
  query: string;
  filters: SearchFilters;
  results: AgentSearchResult[];
  /** Task category the broker detected from the NL query (powers per-task TrustRank ordering). */
  detectedTask?: string | null;
  /** How intent was parsed: Vertex/Gemini when available, else the deterministic fallback. */
  source?: "vertex" | "deterministic";
}

export function useSearch() {
  return useMutation({
    mutationFn: (query: string) =>
      postJSON<SearchResponse>("/api/search", { query }),
  });
}

/* ------------------------- trust network (bubble viz) -------------------- */

/** One agent bubble in the /network trust constellation. */
export interface NetworkNode {
  id: string; // `${network}:${agentId}`
  agentId: string;
  network: "mainnet" | "arc";
  name: string;
  ensName: string | null;
  trustRank: number | null; // 0–100, for label/sort
  trustRankRaw: number | null; // raw eigenvector, for bubble area
  topTask: string | null; // dominant task → cluster + color
  taskScore?: number | null; // per-task score when a task filter is active
}

/** A directed trust-flow edge between two agent bubbles. */
export interface NetworkEdge {
  source: string; // node id
  target: string; // node id
  weight: number;
}

export interface NetworkResponse {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  tasks: string[]; // available task categories for the filter chips
  updatedAt: string | null; // trustrank_updated_at, for the "scores updated …" stamp
}

export function useNetwork(
  task?: string | null,
): UseQueryResult<NetworkResponse> {
  return useQuery({
    queryKey: ["network", task ?? "all"],
    queryFn: () =>
      getJSON<NetworkResponse>(
        `/api/network${task ? `?task=${encodeURIComponent(task)}` : ""}`,
      ),
  });
}

export function useStats(): UseQueryResult<IndexStats> {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => getJSON<IndexStats>("/api/stats"),
  });
}

export function useActivity(): UseQueryResult<ActivityBucket[]> {
  return useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const data = await getJSON<{ activity: ActivityBucket[] }>(
        "/api/activity",
      );
      return data.activity;
    },
  });
}

export function useDemoRun() {
  return useMutation({
    mutationFn: () => postJSON<DemoRunResponse>("/api/demo/run", {}),
  });
}
