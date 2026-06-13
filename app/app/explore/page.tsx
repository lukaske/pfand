"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Filter, TrendingUp, Zap } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { StatTile } from "@/components/stat-tile";
import { Heatmap } from "@/components/heatmap";
import { NetworkBadge } from "@/components/network-badge";
import { ReputationBadge, scoreColor } from "@/components/reputation-badge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useActivity,
  useAgents,
  useStats,
  type AgentFilters,
} from "@/lib/api";
import { formatCount, formatUsdc } from "@/lib/format";
import { ALL_SKILLS } from "@/lib/seed";
import { cn } from "@/lib/utils";

const SORTS: { value: NonNullable<AgentFilters["sort"]>; label: string }[] = [
  { value: "score", label: "Reputation" },
  { value: "feedback", label: "Most feedback" },
  { value: "price", label: "Lowest price" },
  { value: "recent", label: "Newest" },
];

export default function ExplorePage() {
  const [filters, setFilters] = useState<AgentFilters>({
    network: "all",
    skill: "all",
    sort: "score",
  });

  const stats = useStats();
  const agents = useAgents(filters);
  const activity = useActivity();

  function patch(p: Partial<AgentFilters>) {
    setFilters((f) => ({ ...f, ...p }));
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            ERC-8004 Explorer
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Every agent, ranked by paid reputation.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Live index of Registered and NewFeedback events across mainnet and Arc.
            Reputation is payment-backed — each signal is tied to a settled job.
          </p>
        </div>

        {/* Stat tiles */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.isLoading || !stats.data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : (
            <>
              <StatTile
                label="Agents indexed"
                value={formatCount(stats.data.agentsIndexed)}
                sub={`${stats.data.byNetwork.arc} arc · ${stats.data.byNetwork.mainnet} mainnet`}
                className="animate-in fade-in slide-in-from-bottom-3 duration-700"
              />
              <StatTile
                label="Feedback signals"
                value={formatCount(stats.data.feedbackSignals)}
                sub="on-chain, non-revoked"
                className="animate-in fade-in slide-in-from-bottom-3 duration-700"
                style={{ animationDelay: "80ms" }}
              />
              <StatTile
                label="USDC escrowed"
                value={formatUsdc(stats.data.usdcEscrowed * 1_000_000)}
                unit="USDC"
                accent="text-pfand-held"
                className="animate-in fade-in slide-in-from-bottom-3 duration-700"
                style={{ animationDelay: "160ms" }}
              />
              <StatTile
                label="Pfand returned"
                value={
                  stats.data.pfandReturnedPct == null
                    ? "—"
                    : stats.data.pfandReturnedPct.toFixed(1)
                }
                unit="%"
                accent="text-pfand-returned"
                sub="deposits reclaimed"
                className="animate-in fade-in slide-in-from-bottom-3 duration-700"
                style={{ animationDelay: "240ms" }}
              />
            </>
          )}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Agents table */}
          <Card className="order-2 gap-0 overflow-hidden p-0 lg:order-1">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select
                value={filters.network}
                onValueChange={(v) => patch({ network: v as AgentFilters["network"] })}
              >
                <SelectTrigger className="h-8 w-[130px] font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All networks</SelectItem>
                  <SelectItem value="arc">Arc</SelectItem>
                  <SelectItem value="mainnet">Mainnet</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.skill}
                onValueChange={(v) => patch({ skill: v })}
              >
                <SelectTrigger className="h-8 w-[160px] font-mono text-xs">
                  <SelectValue placeholder="All skills" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All skills</SelectItem>
                  {ALL_SKILLS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={() => patch({ x402: !filters.x402 })}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 font-mono text-xs transition-colors",
                  filters.x402
                    ? "border-signal/40 bg-signal/10 text-signal"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Zap className="h-3.5 w-3.5" />
                x402
              </button>
              <button
                type="button"
                onClick={() => patch({ payable: !filters.payable })}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-3 font-mono text-xs transition-colors",
                  filters.payable
                    ? "border-pfand-returned/40 bg-pfand-returned/10 text-pfand-returned"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                payable
              </button>

              <div className="ml-auto">
                <Select
                  value={filters.sort}
                  onValueChange={(v) => patch({ sort: v as AgentFilters["sort"] })}
                >
                  <SelectTrigger className="h-8 w-[150px] font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Agent
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Network
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    x402
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Reputation
                  </TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider">
                    Price
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    State
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.isLoading || !agents.data
                  ? [0, 1, 2, 3, 4].map((i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : agents.data.agents.map((a) => (
                      <TableRow key={a.agentId} className="group">
                        <TableCell>
                          <Link
                            href={`/agent/${a.agentId}`}
                            className="flex items-center gap-2"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-display text-sm font-semibold text-foreground">
                                {a.name}
                                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              </div>
                              <div className="truncate font-mono text-[10px] text-muted-foreground">
                                {a.ensName}
                              </div>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <NetworkBadge network={a.network} />
                        </TableCell>
                        <TableCell>
                          {a.x402Support ? (
                            <Zap className="h-4 w-4 text-signal" />
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ReputationBadge reputation={a.reputation} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
                          {a.priceUsdc != null ? (
                            <>
                              {formatUsdc(a.priceUsdc * 1_000_000)}
                              <span className="ml-1 text-muted-foreground">
                                USDC
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">free</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {a.payable ? (
                            <Badge
                              variant="outline"
                              className="gap-1.5 border-pfand-returned/30 font-mono text-[10px] text-pfand-returned"
                            >
                              <span className="size-1.5 rounded-full bg-pfand-returned" />
                              payable
                            </Badge>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              listed
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </Card>

          {/* Side rail: heatmap + trend */}
          <div className="order-1 flex flex-col gap-6 lg:order-2">
            <Card className="gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Activity · 90d
                </span>
                <TrendingUp className="h-4 w-4 text-signal" />
              </div>
              {activity.isLoading || !activity.data ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <Heatmap data={activity.data} />
              )}
            </Card>

            <ReputationTrend />
          </div>
        </div>
      </main>
    </>
  );
}

function ReputationTrend() {
  const agents = useAgents({ sort: "score" });
  const top = agents.data?.agents.slice(0, 5) ?? [];
  return (
    <Card className="gap-3 p-5">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Reputation leaders
      </span>
      <div className="flex flex-col gap-3">
        {agents.isLoading
          ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)
          : top.map((a) => {
              const s = a.reputation.scoreNormalized ?? 0;
              return (
                <Link
                  key={a.agentId}
                  href={`/agent/${a.agentId}`}
                  className="group flex items-center gap-3"
                >
                  <span className="w-20 shrink-0 truncate font-mono text-xs text-foreground group-hover:text-signal">
                    {a.name}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full bg-current",
                        scoreColor(s),
                      )}
                      style={{ width: `${s}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "w-8 shrink-0 text-right font-mono text-xs tabular-nums",
                      scoreColor(s),
                    )}
                  >
                    {s}
                  </span>
                </Link>
              );
            })}
      </div>
    </Card>
  );
}
