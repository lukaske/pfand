"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  ChevronLeft,
  ChevronRight,
  Filter,
  TrendingUp,
  Zap,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { StatTile } from "@/components/stat-tile";
import { Heatmap } from "@/components/heatmap";
import { NetworkBadge } from "@/components/network-badge";
import {
  ReputationBadge,
  fmtScore,
  headlineScore,
  scoreColor,
} from "@/components/reputation-badge";
import { TopTaskChip, EvidenceLine, TagChips } from "@/components/agent-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
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
import { agentName, formatCount, formatUsdc } from "@/lib/format";
import { RecomputeButton } from "@/components/recompute-button";
import { ALL_SKILLS } from "@/lib/seed";
import { cn } from "@/lib/utils";

const SORTS: { value: NonNullable<AgentFilters["sort"]>; label: string }[] = [
  { value: "score", label: "TrustRank" },
  { value: "feedback", label: "Most feedback" },
  { value: "recent", label: "Newest" },
];

const PAGE_SIZE = 15;

/** Two-letter avatar fallback from an agent name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "8004";
}

export default function ExplorePage() {
  const [filters, setFilters] = useState<AgentFilters>({
    network: "all",
    skill: "all",
    sort: "score",
  });
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [cardOnly, setCardOnly] = useState(false);
  const [page, setPage] = useState(0);

  const stats = useStats();
  const agents = useAgents(filters);
  const activity = useActivity();

  function patch(p: Partial<AgentFilters>) {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  }
  function toggleDir() {
    setDir((d) => (d === "desc" ? "asc" : "desc"));
    setPage(0);
  }

  // The API returns the active sort key descending; reverse it for ascending.
  // `cardOnly` hides bare NFTs (agents with no resolvable identity card).
  const sorted = useMemo(() => {
    let list = agents.data?.agents ?? [];
    if (cardOnly) list = list.filter((a) => a.name);
    return dir === "asc" ? [...list].reverse() : list;
  }, [agents.data, dir, cardOnly]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-3 duration-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-ink">
              ERC-8004 Explorer
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Every agent, ranked by paid reputation.
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Live index of Registered and NewFeedback events across mainnet and
              Arc. Reputation is payment-backed — each signal is tied to a settled
              job.
            </p>
          </div>
          <RecomputeButton />
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
          <Card className="order-2 gap-0 overflow-hidden rounded-2xl p-0 shadow-soft-sm lg:order-1">
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
                  "inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 font-mono text-xs transition-colors",
                  filters.x402
                    ? "border-transparent bg-signal-wash text-signal-ink"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Zap className="h-3.5 w-3.5" />
                x402
              </button>

              <button
                type="button"
                onClick={() => {
                  setCardOnly((v) => !v);
                  setPage(0);
                }}
                title="Hide bare NFTs (agents with no identity card)"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 font-mono text-xs transition-colors",
                  cardOnly
                    ? "border-transparent bg-signal-wash text-signal-ink"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <BadgeCheck className="h-3.5 w-3.5" />
                Has card
              </button>

              <div className="ml-auto flex items-center gap-2">
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
                <button
                  type="button"
                  onClick={toggleDir}
                  title={dir === "desc" ? "High → low" : "Low → high"}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border px-3 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {dir === "desc" ? (
                    <ArrowDown className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                  {dir === "desc" ? "High" : "Low"}
                </button>
              </div>
            </div>

            <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
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
                    TrustRank
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-wider">
                    Known for
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.isLoading || !agents.data
                  ? [0, 1, 2, 3, 4].map((i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : paged.map((a) => (
                      <TableRow key={a.agentId} className="group">
                        <TableCell>
                          <Link
                            href={`/agent/${a.agentId}`}
                            className="flex items-center gap-2.5"
                          >
                            <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-border">
                              <AvatarImage
                                src={a.image ?? undefined}
                                alt={a.name}
                              />
                              <AvatarFallback className="rounded-lg bg-muted font-mono text-[9px] text-muted-foreground">
                                {a.name ? (
                                  initials(a.name)
                                ) : (
                                  <Bot className="h-3.5 w-3.5" />
                                )}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 truncate font-display text-sm font-semibold text-foreground">
                                {agentName(a)}
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              </div>
                              {a.ensName ? (
                                <div className="truncate font-mono text-[10px] font-medium text-signal-ink">
                                  {a.ensName}
                                </div>
                              ) : (
                                <div className="truncate font-mono text-[10px] text-muted-foreground">
                                  #{a.agentId}
                                </div>
                              )}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <NetworkBadge network={a.network} />
                        </TableCell>
                        <TableCell>
                          {a.x402Support ? (
                            <Zap className="h-4 w-4 text-signal-ink" />
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <ReputationBadge reputation={a.reputation} />
                            <EvidenceLine reputation={a.reputation} />
                          </div>
                        </TableCell>
                        <TableCell>
                          {a.reputation.tags && a.reputation.tags.length > 0 ? (
                            <TagChips tags={a.reputation.tags} max={3} />
                          ) : a.reputation.topTask ? (
                            <TopTaskChip task={a.reputation.topTask} />
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
            </div>
            {/* Pagination */}
            {agents.data && sorted.length > 0 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 font-mono text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{" "}
                  {sorted.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <span className="tabular-nums">
                    {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage >= pageCount - 1}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* Side rail: heatmap + trend */}
          <div className="order-1 flex flex-col gap-6 lg:order-2">
            <Card className="gap-3 rounded-2xl p-5 shadow-soft-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Activity · 90d
                </span>
                <TrendingUp className="h-4 w-4 text-signal-ink" />
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
    <Card className="gap-3 rounded-2xl p-5 shadow-soft-sm">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Reputation leaders
      </span>
      <div className="flex flex-col gap-3">
        {agents.isLoading
          ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)
          : top.map((a) => {
              const s = headlineScore(a.reputation) ?? 0;
              return (
                <Link
                  key={a.agentId}
                  href={`/agent/${a.agentId}`}
                  className="group flex items-center gap-3"
                >
                  <span className="w-20 shrink-0 truncate font-mono text-xs text-foreground group-hover:text-signal-ink">
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
                      "w-12 shrink-0 text-right font-mono text-xs tabular-nums",
                      scoreColor(s),
                    )}
                  >
                    {fmtScore(s)}
                  </span>
                </Link>
              );
            })}
      </div>
    </Card>
  );
}
