"use client";

import type { ActivityBucket } from "@pfand/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* Sequential lime ramp — matches the design system's #ds-heatmap mapping:
   wash → signal mixed into card at 35/60% → signal → signal-ink. */
const RAMP = [
  "var(--signal-wash)",
  "color-mix(in oklch, var(--signal) 35%, var(--card))",
  "color-mix(in oklch, var(--signal) 60%, var(--card))",
  "var(--signal)",
  "var(--signal-ink)",
] as const;

/** Map a 0..1 intensity to one of the 5 discrete ramp stops. */
function cellBackground(intensity: number): string {
  if (intensity < 0.12) return "var(--muted)";
  const idx = Math.min(4, Math.floor(intensity * 5));
  return RAMP[idx];
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
          return (
            <Tooltip key={d.day}>
              <TooltipTrigger asChild>
                <div
                  className="size-3 rounded-[3px] transition-transform hover:scale-125"
                  style={{ background: cellBackground(total / max) }}
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
        <span className="size-3 rounded-[3px]" style={{ background: "var(--muted)" }} />
        {RAMP.map((bg) => (
          <span key={bg} className="size-3 rounded-[3px]" style={{ background: bg }} />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
