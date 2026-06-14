import { cn } from "@/lib/utils";

/**
 * The Pfand brand device: a prompt cursor. Static (steady bar) by default;
 * pass `blink` to enable the blinking animation — reserved for the landing
 * hero title. Respects prefers-reduced-motion via CSS.
 */
export function PfandCursor({
  className,
  style,
  blink = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  blink?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn("pfand-cursor", blink && "pfand-cursor--blink", className)}
      style={style}
    />
  );
}
