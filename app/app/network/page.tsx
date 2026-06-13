"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetwork } from "@/lib/api";
import { buildTaskColors } from "@/components/trust-graph";
import { cn } from "@/lib/utils";

// d3-force touches no browser APIs, but the graph is heavy + client-only — load
// it lazily with no SSR so the page shell streams immediately.
const TrustGraph = dynamic(
  () => import("@/components/trust-graph").then((m) => m.TrustGraph),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[520px] w-full rounded-2xl" />,
  },
);

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function NetworkPage() {
  const [task, setTask] = useState<string | null>(null);
  const { data, isLoading } = useNetwork(task);

  const tasks = data?.tasks ?? [];
  // Color legend keyed by the dominant tasks actually present as bubbles.
  const present: string[] = [];
  for (const n of data?.nodes ?? []) {
    const t = n.topTask ?? "—";
    if (!present.includes(t)) present.push(t);
  }
  const colors = buildTaskColors(present);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-ink">
            ERC-8004 Trust Graph
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Trust Constellation
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Bubble size = TrustRank · color = dominant task · lines = trust flow
            between agents.
          </p>
        </div>

        {/* Task filter chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTask(null)}
            className={cn(
              "inline-flex h-7 items-center rounded-xl border px-3 font-mono text-[11px] transition-colors",
              task === null
                ? "border-transparent bg-signal-wash text-signal-ink"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {tasks.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTask(t)}
              className={cn(
                "inline-flex h-7 items-center rounded-xl border px-3 font-mono text-[11px] transition-colors",
                task === t
                  ? "border-transparent bg-signal-wash text-signal-ink"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
          {/* Graph canvas */}
          <Card className="order-2 gap-0 overflow-hidden rounded-2xl p-2 shadow-soft-sm lg:order-1">
            {isLoading || !data ? (
              <Skeleton className="h-[520px] w-full rounded-2xl" />
            ) : (
              <TrustGraph nodes={data.nodes} edges={data.edges} />
            )}
          </Card>

          {/* Side rail: legend + meta */}
          <div className="order-1 flex flex-col gap-6 lg:order-2">
            <Card className="gap-3 rounded-2xl p-5 shadow-soft-sm">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Task legend
              </span>
              {isLoading || !data ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              ) : present.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  No tasks to show.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {present.map((t) => (
                    <div key={t} className="flex items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ background: colors.get(t) }}
                      />
                      <span className="truncate font-mono text-[11px] text-foreground">
                        {t}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="gap-2 rounded-2xl p-5 shadow-soft-sm">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Index
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  agents
                </span>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {data?.nodes.length ?? "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  trust edges
                </span>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {data?.edges.length ?? "—"}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                scores updated {relativeTime(data?.updatedAt ?? null)}
              </p>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
