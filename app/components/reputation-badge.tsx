import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReputationSummary } from "@pfand/shared";

/** Quality band → color. Green = excellent, amber = decent, red = weak. */
export function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-pfand-returned";
  if (score >= 70) return "text-pfand-held";
  return "text-pfand-forfeited";
}

function bandLabel(score: number | null): string {
  if (score == null) return "unrated";
  if (score >= 90) return "excellent";
  if (score >= 85) return "strong";
  if (score >= 70) return "fair";
  return "weak";
}

/**
 * Headline reputation number: TrustRank (EigenTrust percentile). This is now
 * THE single hero score; when absent the agent is "unrated".
 */
export function headlineScore(reputation: ReputationSummary): number | null {
  return reputation.trustRank ?? null;
}

export function ReputationBadge({
  reputation,
  className,
  showLabel = true,
}: {
  reputation: ReputationSummary;
  className?: string;
  /** Render the trailing "/ band" label. Defaults to true. */
  showLabel?: boolean;
}) {
  const s = headlineScore(reputation);
  const rated = s != null;
  const distrust = reputation.distrustFlag === true;
  const color = scoreColor(s);
  return (
    <Badge
      variant="outline"
      title={
        rated
          ? "TrustRank — EigenTrust percentile (0–100)"
          : "Unrated — no TrustRank yet"
      }
      className={cn(
        "gap-1.5 border-border font-mono text-[11px] tabular-nums",
        color,
        distrust && "border-pfand-forfeited/40",
        className,
      )}
    >
      {distrust ? (
        <TriangleAlert className="h-2.5! w-2.5! text-pfand-forfeited" />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
      {rated ? s : "unrated"}
      {showLabel && rated && (
        <span className="text-muted-foreground">/ {bandLabel(s)}</span>
      )}
      {distrust && (
        <span className="text-pfand-forfeited" title="Net-negative feedback">
          distrust
        </span>
      )}
    </Badge>
  );
}
