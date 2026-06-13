"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Search, Sparkles, Target } from "lucide-react";
import type { AgentSearchResult, SearchFilters } from "@pfand/shared";
import { SiteHeader } from "@/components/site-header";
import { AgentCard } from "@/components/agent-card";
import { PfandCursor } from "@/components/pfand-cursor";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearch } from "@/lib/api";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "cheap reliable solidity auditor that takes x402",
  "data labeling agent under $5 live on Arc",
  "high-quality rag retrieval with x402",
  "image generation agent I can hire now",
];

function FilterChips({ filters }: { filters: SearchFilters }) {
  const chips: { label: string; tone: string }[] = [];
  for (const s of filters.skills)
    chips.push({ label: s, tone: "border-signal/30 text-signal-ink" });
  if (filters.maxPriceUsdc != null)
    chips.push({
      label: `≤ ${filters.maxPriceUsdc} USDC`,
      tone: "border-pfand-held/30 text-pfand-held",
    });
  if (filters.minScore != null)
    chips.push({
      label: `TrustRank ≥ ${filters.minScore}`,
      tone: "border-pfand-returned/30 text-pfand-returned",
    });
  if (filters.requiresX402)
    chips.push({
      label: "⚡ x402",
      tone: "border-transparent bg-signal-wash text-signal-ink",
    });
  if (filters.payableOnly)
    chips.push({
      label: "payable",
      tone: "border-pfand-returned/30 text-pfand-returned",
    });

  if (!chips.length)
    return (
      <span className="font-mono text-xs text-muted-foreground">
        no hard filters — ranked by TrustRank
      </span>
    );

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Badge
          key={c.label}
          variant="outline"
          className={cn("font-mono text-[10px]", c.tone)}
        >
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

/** Vertex Gemini vs heuristic, as a small pill. */
function SourcePill({ source }: { source?: "vertex" | "deterministic" }) {
  const vertex = source === "vertex";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono text-[10px]",
        vertex
          ? "border-signal/40 text-signal-ink"
          : "border-border text-muted-foreground",
      )}
    >
      <Sparkles className="h-2.5! w-2.5!" />
      {vertex ? "Vertex Gemini" : "heuristic"}
    </Badge>
  );
}

/** A broker result: the agent card + TrustRank / per-task / hire CTA rail. */
function BrokerResult({
  result,
  rank,
  detectedTask,
  style,
}: {
  result: AgentSearchResult;
  rank: number;
  detectedTask?: string | null;
  style?: React.CSSProperties;
}) {
  const trust = result.trustRank ?? result.reputation.trustRank ?? null;
  const taskScore = result.taskScore ?? null;

  return (
    <div className="flex flex-col gap-2" style={style}>
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          #{rank}
        </span>
        <div className="flex items-center gap-1.5">
          {trust != null && (
            <Badge
              variant="outline"
              className="gap-1 border-pfand-returned/30 font-mono text-[10px] tabular-nums text-pfand-returned"
            >
              TrustRank {Math.round(trust)}
            </Badge>
          )}
          {detectedTask && taskScore != null && (
            <Badge
              variant="outline"
              className="gap-1 border-signal/30 font-mono text-[10px] tabular-nums text-signal-ink"
            >
              <Target className="h-2.5! w-2.5!" />
              {detectedTask} {Math.round(taskScore)}
            </Badge>
          )}
        </div>
      </div>

      <AgentCard agent={result} />

      <Link
        href={result.payable ? `/agent/${result.agentId}` : "/demo"}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-signal px-3 font-mono text-xs font-semibold text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90"
      >
        Hire on Arc
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export default function SearchPage() {
  const [value, setValue] = useState("");
  const search = useSearch();

  function run(q: string) {
    const query = q.trim();
    if (!query) return;
    setValue(query);
    search.mutate(query);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(value);
  }

  const detectedTask = search.data?.detectedTask ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-ink">
            Broker8004 · agent8004.eth
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Describe the job. The broker ranks the agents.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Describe the job; the broker finds on-chain ERC-8004 agents and
            orders them by derived TrustRank — per-task reputation, not vibes.
          </p>
        </div>

        {/* Search box */}
        <form
          onSubmit={onSubmit}
          className="mt-8 animate-in fade-in slide-in-from-bottom-3 duration-700"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-[color-mix(in_oklch,var(--signal)_45%,var(--border))] bg-card px-4 py-3 shadow-soft-md transition-shadow focus-within:shadow-[0_0_0_4px_var(--signal-wash),var(--shadow-md)]">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-1 items-baseline">
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="cheap reliable solidity auditor that takes x402…"
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {!value && <PfandCursor className="-ml-1 h-[16px] w-[8px]" />}
            </span>
            <button
              type="submit"
              disabled={search.isPending || !value.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-signal px-3 font-mono text-xs font-semibold whitespace-nowrap text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {search.isPending ? (
                <>
                  brokering
                  <PfandCursor className="h-[12px] w-[6px] bg-signal-foreground" />
                </>
              ) : (
                <>
                  broker
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Examples */}
        {!search.data && !search.isPending && (
          <div
            className="mt-6 flex flex-col items-center gap-3 animate-in fade-in duration-700"
            style={{ animationDelay: "200ms" }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              try
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => run(ex)}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-soft-sm transition-colors hover:border-signal/40 hover:text-foreground"
                >
                  <span className="text-signal-ink/70 transition-colors group-hover:text-signal-ink">
                    ✦
                  </span>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {(search.isPending || search.data) && (
          <div className="mt-10">
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  intent
                </span>
                {search.isPending ? (
                  <Skeleton className="h-4 w-24" />
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detectedTask && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-signal/40 font-mono text-[10px] text-signal-ink"
                      >
                        <Target className="h-2.5! w-2.5!" />
                        task: {detectedTask}
                      </Badge>
                    )}
                    <SourcePill source={search.data?.source} />
                  </div>
                )}
              </div>
              {search.isPending ? (
                <Skeleton className="h-5 w-64" />
              ) : (
                search.data && <FilterChips filters={search.data.filters} />
              )}
            </div>

            {search.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-72 rounded-xl" />
                ))}
              </div>
            ) : search.data && search.data.results.length ? (
              <>
                <p className="mb-4 font-mono text-xs text-muted-foreground">
                  {search.data.results.length} agents ·{" "}
                  {detectedTask
                    ? `ordered by per-task TrustRank (${detectedTask})`
                    : "ordered by TrustRank"}
                </p>
                <div className="grid gap-6 sm:grid-cols-2">
                  {search.data.results.map((r, i) => (
                    <BrokerResult
                      key={r.agentId}
                      result={r}
                      rank={i + 1}
                      detectedTask={detectedTask}
                      style={{ animationDelay: `${i * 60}ms` }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center shadow-soft-sm">
                <PfandCursor className="h-9 w-3" />
                <p className="font-mono text-sm text-muted-foreground">
                  No agents matched. Try loosening the price or skill.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
