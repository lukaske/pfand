"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  ExternalLink,
  Hash,
  Wallet,
  Zap,
} from "lucide-react";
import type { AgentNetwork, FeedbackEntry } from "@pfand/shared";
import { SiteHeader } from "@/components/site-header";
import { NetworkBadge } from "@/components/network-badge";
import { ReputationBadge, scoreColor } from "@/components/reputation-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useAgent } from "@/lib/api";
import {
  agentInitials,
  agentName,
  explorerTxUrl,
  formatScore,
  formatUsdc,
  shortAddress,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useAgent(id);

  if (isError) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-20 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            Agent #{id} not found in the index.
          </p>
          <Link
            href="/explore"
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-signal-ink hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> back to explorer
          </Link>
        </main>
      </>
    );
  }

  const agent = data?.agent;
  const feedback = data?.feedback ?? [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <Link
          href="/explore"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> explorer
        </Link>

        {isLoading || !agent ? (
          <div className="mt-6 flex flex-col gap-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : (
          <>
            {/* Identity block */}
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
              <div className="animate-in fade-in slide-in-from-bottom-3 duration-700">
                <div className="flex items-start gap-4">
                  <Avatar className="h-14 w-14 shrink-0 rounded-xl border border-border shadow-soft-sm">
                    <AvatarImage src={agent.image ?? undefined} alt={agentName(agent)} />
                    <AvatarFallback className="rounded-xl bg-muted font-mono text-xs text-muted-foreground">
                      {agent.name ? agentInitials(agent.name) : <Bot className="h-5 w-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                        {agentName(agent)}
                      </h1>
                      <NetworkBadge network={agent.network} />
                      {agent.x402Support && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-transparent bg-signal-wash font-mono text-[10px] uppercase tracking-wider text-signal-ink"
                        >
                          <Zap className="h-2.5! w-2.5!" /> x402
                        </Badge>
                      )}
                      {agent.payable && (
                        <Badge
                          variant="outline"
                          className="gap-1.5 border-pfand-returned/30 font-mono text-[10px] text-pfand-returned"
                        >
                          <span className="size-1.5 rounded-full bg-pfand-returned" />
                          live on Arc
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-signal-ink">
                      {agent.ensName || `#${agent.agentId}`}
                    </p>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {agent.description}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {agent.skills.map((s) => (
                    <Badge
                      key={s}
                      variant="secondary"
                      className="font-mono text-[11px] text-muted-foreground"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>

                <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                  <Field icon={Hash} label="agentId" value={`#${agent.agentId}`} />
                  <Field
                    icon={Wallet}
                    label="owner"
                    value={shortAddress(agent.owner)}
                  />
                  <Field
                    icon={Wallet}
                    label="payTo"
                    value={shortAddress(agent.payToWallet ?? undefined)}
                  />
                </dl>
              </div>

              {/* Hire CTA + price */}
              <Card className="h-fit gap-4 rounded-2xl p-5 shadow-soft-sm animate-in fade-in slide-in-from-bottom-3 duration-700">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    price
                  </span>
                  <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                    {agent.priceUsdc != null ? (
                      <>
                        {formatUsdc(agent.priceUsdc * 1_000_000)}
                        <span className="ml-1 text-sm text-muted-foreground">
                          USDC
                        </span>
                      </>
                    ) : (
                      <span className="text-base text-muted-foreground">
                        free
                      </span>
                    )}
                  </span>
                </div>
                <Separator />
                <ReputationBadge reputation={agent.reputation} className="w-fit" />
                <div className="font-mono text-[11px] text-muted-foreground">
                  {agent.reputation.count} payment-backed signals
                </div>
                {agent.payable ? (
                  <Link
                    href="/demo"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-signal font-mono text-sm font-semibold whitespace-nowrap text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90"
                  >
                    Hire on Arc →
                  </Link>
                ) : (
                  <div className="inline-flex h-10 items-center justify-center rounded-xl border border-border font-mono text-xs text-muted-foreground">
                    not payable on Arc
                  </div>
                )}
              </Card>
            </div>

            {/* ENS records table */}
            <RecordsTable agent={agent} />

            {/* Reputation + feedback */}
            <div className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Reputation
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  showing latest {feedback.length}
                </span>
              </div>
              <Card className="gap-0 overflow-hidden rounded-2xl p-0 shadow-soft-sm">
                {feedback.length === 0 ? (
                  <div className="p-8 text-center font-mono text-sm text-muted-foreground">
                    No feedback yet.
                  </div>
                ) : (
                  feedback.map((f, i) => <FeedbackRow key={i} f={f} />)
                )}
              </Card>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

function RecordsTable({ agent }: { agent: import("@pfand/shared").Agent }) {
  // ENSIP-25 agent-registration + ENSIP-26 agent-context / agent-endpoint text
  // records served live by the CCIP-Read gateway from the index.
  const records: { key: string; value: string; spec: string }[] = [
    {
      key: "agent-registration[erc-8004]",
      value: `eip155:${agent.network === "arc" ? "9999" : "1"}:${shortAddress(
        agent.owner,
      )}#${agent.agentId}`,
      spec: "ENSIP-25",
    },
    {
      key: "agent-context",
      value: agent.agentURI,
      spec: "ENSIP-26",
    },
    {
      key: "agent-endpoint",
      value: agent.serviceEndpoint ?? "—",
      spec: "ENSIP-26",
    },
    {
      key: "avatar",
      value: agent.image ?? `eip155 · ${agent.ensName}`,
      spec: "ENSIP-12",
    },
  ];

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-signal-ink" />
        <h2 className="font-display text-xl font-semibold text-foreground">
          ENS records
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          served via CCIP-Read
        </span>
      </div>
      <Card className="gap-0 overflow-hidden rounded-2xl p-0 shadow-soft-sm">
        {records.map((r, i) => (
          <div
            key={r.key}
            className={cn(
              "flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4",
              i > 0 && "border-t border-border",
            )}
          >
            <div className="flex w-full items-center justify-between gap-2 sm:w-72 sm:shrink-0">
              <span className="font-mono text-xs text-foreground">{r.key}</span>
              <Badge
                variant="secondary"
                className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
              >
                {r.spec}
              </Badge>
            </div>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {r.value}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function FeedbackRow({ f }: { f: FeedbackEntry }) {
  const score = formatScore(f.value, f.valueDecimals);
  const n = Number(score);
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3.5",
        "border-b border-border last:border-b-0",
        f.isRevoked && "opacity-40",
      )}
    >
      <span
        className={cn(
          "w-10 shrink-0 font-mono text-sm font-semibold tabular-nums",
          scoreColor(n),
        )}
      >
        {score}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="font-mono text-[10px] text-muted-foreground"
        >
          {f.tag1}
        </Badge>
        <Badge
          variant="secondary"
          className="font-mono text-[10px] text-muted-foreground"
        >
          {f.tag2}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">
          by {shortAddress(f.client)}
        </span>
        {f.isRevoked && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-pfand-forfeited">
            revoked
          </span>
        )}
      </div>
      <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">
        {f.timestamp?.slice(0, 10)}
      </span>
      {f.txHash && (
        <a
          href={explorerTxUrl(f.network, f.txHash)}
          target="_blank"
          rel="noreferrer"
          title={`View on ${f.network === "mainnet" ? "Etherscan" : "Arcscan"}`}
          className="shrink-0 text-muted-foreground transition-colors hover:text-signal-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
