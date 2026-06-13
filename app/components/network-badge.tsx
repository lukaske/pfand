import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentNetwork } from "@pfand/shared";

export function NetworkBadge({
  network,
  className,
}: {
  network: AgentNetwork;
  className?: string;
}) {
  const isArc = network === "arc";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-mono text-[10px] uppercase tracking-wider",
        isArc
          ? "border-signal/30 text-signal"
          : "border-chart-3/30 text-chart-3",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isArc ? "bg-signal" : "bg-chart-3",
        )}
      />
      {isArc ? "Arc" : "Mainnet"}
    </Badge>
  );
}
