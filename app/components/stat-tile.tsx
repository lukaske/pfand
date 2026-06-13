import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  unit,
  accent,
  sub,
  className,
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  sub?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft-sm transition-colors hover:border-signal/40",
        className,
      )}
      style={style}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-2xl font-semibold tabular-nums text-foreground",
          accent,
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-sm text-muted-foreground">{unit}</span>
        )}
      </span>
      {sub && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {sub}
        </span>
      )}
    </div>
  );
}
