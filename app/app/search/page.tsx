"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import type { SearchFilters } from "@pfand/shared";
import { SiteHeader } from "@/components/site-header";
import { AgentCard } from "@/components/agent-card";
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
    chips.push({ label: s, tone: "border-signal/30 text-signal" });
  if (filters.maxPriceUsdc != null)
    chips.push({
      label: `≤ ${filters.maxPriceUsdc} USDC`,
      tone: "border-pfand-held/30 text-pfand-held",
    });
  if (filters.minScore != null)
    chips.push({
      label: `score ≥ ${filters.minScore}`,
      tone: "border-pfand-returned/30 text-pfand-returned",
    });
  if (filters.requiresX402)
    chips.push({ label: "x402", tone: "border-signal/30 text-signal" });
  if (filters.payableOnly)
    chips.push({
      label: "payable",
      tone: "border-pfand-returned/30 text-pfand-returned",
    });

  if (!chips.length)
    return (
      <span className="font-mono text-xs text-muted-foreground">
        no hard filters — ranked semantically
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

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            Natural-language discovery
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Describe the agent. We&rsquo;ll find it.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            We extract structured filters from your sentence, then rank the
            ERC-8004 index by payment-backed reputation and semantic fit.
          </p>
        </div>

        {/* Search box */}
        <form
          onSubmit={onSubmit}
          className="mt-8 animate-in fade-in slide-in-from-bottom-3 duration-700"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors focus-within:border-signal/50">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="cheap reliable solidity auditor that takes x402…"
              className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={search.isPending || !value.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-signal px-3 font-mono text-xs font-semibold text-signal-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {search.isPending ? "searching…" : "search"}
              <ArrowRight className="h-3.5 w-3.5" />
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
                  className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-signal/40 hover:text-foreground"
                >
                  <Sparkles className="h-3 w-3 text-signal/60 group-hover:text-signal" />
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {(search.isPending || search.data) && (
          <div className="mt-10">
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                extracted filters
              </span>
              {search.isPending ? (
                <Skeleton className="h-5 w-64" />
              ) : (
                search.data && <FilterChips filters={search.data.filters} />
              )}
            </div>

            {search.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-56 rounded-xl" />
                ))}
              </div>
            ) : search.data && search.data.results.length ? (
              <>
                <p className="mb-4 font-mono text-xs text-muted-foreground">
                  {search.data.results.length} agents · ranked by semantic fit
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {search.data.results.map((r, i) => (
                    <AgentCard
                      key={r.agentId}
                      agent={r}
                      className="animate-in fade-in slide-in-from-bottom-3 duration-700"
                      style={{ animationDelay: `${i * 60}ms` }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-card/40 p-10 text-center">
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
