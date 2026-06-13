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
 * Headline reputation number: TrustRank (EigenTrust percentile) when the
 * scoring pipeline has filled it in, otherwise the legacy normalized score.
 */
export function headlineScore(reputation: ReputationSummary): number | null {
  return reputation.trustRank ?? reputation.scoreNormalized;
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
  const isTrustRank = reputation.trustRank != null;
  const color = scoreColor(s);
  return (
    <Badge
      variant="outline"
      title={isTrustRank ? "TrustRank — EigenTrust percentile" : "Reputation score"}
      className={cn(
        "gap-1.5 border-border font-mono text-[11px] tabular-nums",
        color,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full bg-current")} />
      {s == null ? "—" : s}
      {showLabel && (
        <span className="text-muted-foreground">/ {bandLabel(s)}</span>
      )}
    </Badge>
  );
}
