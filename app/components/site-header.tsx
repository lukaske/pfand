import Link from "next/link";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/search", label: "Search" },
  { href: "/demo", label: "Live Demo" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
            Pfand
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-signal">
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
            className="hidden gap-1.5 border-pfand-returned/30 font-mono text-[10px] text-pfand-returned sm:inline-flex"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-pfand-returned" />
            ARC TESTNET
          </Badge>
          <Link
            href="/demo"
            className="rounded-md bg-signal px-3 py-1.5 font-mono text-xs font-semibold text-signal-foreground transition-opacity hover:opacity-90"
          >
            Run the loop →
          </Link>
        </div>
      </div>
    </header>
  );
}
