import { cn } from "@/lib/utils";

/**
 * The Pfand brand device: a blinking prompt cursor.
 * Reused wherever a "prompt" is implied — the logo wordmark, the search
 * field (trailing the query), as a loading indicator in place of a spinner,
 * and large in empty states. Respects prefers-reduced-motion via CSS.
 */
export function PfandCursor({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span aria-hidden className={cn("pfand-cursor", className)} style={style} />
  );
}
