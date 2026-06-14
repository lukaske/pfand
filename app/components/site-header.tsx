import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PfandCursor } from "@/components/pfand-cursor";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/network", label: "Network" },
  { href: "/search", label: "Broker" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="flex items-baseline">
            <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
              Pfand
            </span>
            <PfandCursor className="ml-[3px] h-[15px] w-[6px]" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-signal-ink">
            8004
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Badge
            variant="outline"
            className="hidden gap-1.5 border-pfand-returned/35 bg-card font-mono text-[10px] text-pfand-returned shadow-soft-sm sm:inline-flex"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-pfand-returned" />
            ARC TESTNET
          </Badge>
          <Link
            href="/network"
            className="rounded-xl bg-signal px-3 py-1.5 font-mono text-xs font-semibold whitespace-nowrap text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90"
          >
            See the graph →
          </Link>
        </div>
      </div>
    </header>
  );
}
