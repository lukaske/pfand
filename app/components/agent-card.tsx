import Link from "next/link";
import { ArrowUpRight, Zap } from "lucide-react";
import type { Agent, AgentSearchResult } from "@pfand/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { NetworkBadge } from "@/components/network-badge";
import { ReputationBadge } from "@/components/reputation-badge";
import { formatUsdc, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

function isSearchResult(a: Agent | AgentSearchResult): a is AgentSearchResult {
  return "semanticScore" in a;
}

const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

/** Stable per-tag color from the chart palette. */
export function taskColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return CHART_VARS[h % CHART_VARS.length];
}

/** Small top-task chip tinted by its tag's chart color. */
export function TopTaskChip({
  task,
  className,
}: {
  task: string;
  className?: string;
}) {
  const c = taskColor(task);
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-border/60 bg-card font-mono text-[10px] text-foreground",
        className,
      )}
      title={`Top task — ${task}`}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: c }}
      />
      {task}
    </Badge>
  );
}

export function AgentCard({
  agent,
  className,
  style,
}: {
  agent: Agent | AgentSearchResult;
  className?: string;
  style?: React.CSSProperties;
}) {
  const search = isSearchResult(agent) ? agent : null;

  return (
    <Card
      className={cn(
        "group gap-0 rounded-2xl border border-border p-0 shadow-soft-sm transition-colors hover:border-signal/40",
        className,
      )}
      style={style}
    >
      <Link href={`/agent/${agent.agentId}`} className="block p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-display text-lg font-semibold text-foreground">
                {agent.name}
              </h3>
              {agent.x402Support && (
                <Badge
                  variant="outline"
                  className="gap-1 border-transparent bg-signal-wash font-mono text-[9px] uppercase tracking-wider text-signal-ink"
                >
                  <Zap className="h-2.5! w-2.5!" />
                  x402
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {agent.ensName ?? shortAddress(agent.owner)} · #{agent.agentId}
            </p>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-signal-ink" />
        </div>

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {agent.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {agent.skills.slice(0, 3).map((s) => (
            <Badge
              key={s}
              variant="secondary"
              className="font-mono text-[10px] text-muted-foreground"
            >
              {s}
            </Badge>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <NetworkBadge network={agent.network} />
            <ReputationBadge reputation={agent.reputation} />
            {agent.reputation.topTask && (
              <TopTaskChip task={agent.reputation.topTask} />
            )}
          </div>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {agent.priceUsdc != null ? (
              <>
                {formatUsdc(agent.priceUsdc * 1_000_000)}{" "}
                <span className="text-muted-foreground">USDC</span>
              </>
            ) : (
              <span className="text-muted-foreground">free</span>
            )}
          </span>
        </div>

        {search && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-transparent bg-signal-wash p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-signal-ink">
                match
              </span>
              <span className="font-mono text-[11px] tabular-nums text-foreground">
                {Math.round((search.semanticScore ?? 0) * 100)}%
              </span>
            </div>
            <Progress
              value={(search.semanticScore ?? 0) * 100}
              className="h-1 bg-card [&_[data-slot=progress-indicator]]:bg-signal"
            />
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              {search.matchReason}
            </p>
          </div>
        )}
      </Link>
    </Card>
  );
}
