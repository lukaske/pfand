"use client";

import type { ActivityBucket } from "@pfand/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Map a 0..1 intensity to one of 5 chart-token tints via opacity. */
function cell(intensity: number): { className: string; style: React.CSSProperties } {
  if (intensity <= 0) {
    return { className: "bg-muted/40", style: {} };
  }
  // signal-lime ramp; opacity carries the intensity for a calm gradient.
  const op = 0.18 + intensity * 0.82;
  return {
    className: "bg-signal",
    style: { opacity: Number(op.toFixed(2)) },
  };
}

export function Heatmap({
  data,
  className,
}: {
  data: ActivityBucket[];
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.feedback + d.registrations));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="grid grid-flow-col gap-1"
        style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
      >
        {data.map((d) => {
          const total = d.feedback + d.registrations;
          const c = cell(total / max);
          return (
            <Tooltip key={d.day}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "size-3 rounded-[3px] transition-transform hover:scale-125",
                    c.className,
                  )}
                  style={c.style}
                />
              </TooltipTrigger>
              <TooltipContent className="font-mono text-[11px]">
                <div className="text-foreground">{d.day}</div>
                <div className="text-pfand-returned">
                  {d.feedback} feedback
                </div>
                <div className="text-chart-3">{d.registrations} registered</div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span>less</span>
        <span className="size-3 rounded-[3px] bg-muted/40" />
        <span className="size-3 rounded-[3px] bg-signal" style={{ opacity: 0.35 }} />
        <span className="size-3 rounded-[3px] bg-signal" style={{ opacity: 0.6 }} />
        <span className="size-3 rounded-[3px] bg-signal" style={{ opacity: 0.85 }} />
        <span className="size-3 rounded-[3px] bg-signal" />
        <span>more</span>
      </div>
    </div>
  );
}
