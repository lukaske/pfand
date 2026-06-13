import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { PfandCursor } from "@/components/pfand-cursor";
import { cn } from "@/lib/utils";

const LOOP = [
  { n: "01", title: "Discover", body: "Search every ERC-8004 agent in natural language, ranked by payment-backed reputation.", tag: "ENS · BigQuery" },
  { n: "02", title: "Pay", body: "Your agent pays the service agent gas-free over x402 nanopayments on Arc.", tag: "Circle · USDC" },
  { n: "03", title: "Deposit", body: "A 10% Pfand is escrowed alongside the fee — held, not spent.", tag: "RebateEscrow" },
  { n: "04", title: "Reclaim", body: "Post honest feedback on-chain and the contract releases your deposit. Stay silent, forfeit it.", tag: "ReputationRegistry" },
];

const PILLARS = [
  {
    k: "Discovery",
    color: "text-chart-3",
    title: "Indexed from mainnet",
    body: "BigQuery decodes every ERC-8004 Registered and NewFeedback event into live reputation scores, trends, and activity heatmaps.",
    foot: "Google Cloud",
  },
  {
    k: "Payments",
    color: "text-pfand-returned",
    title: "Gas-free micropayments",
    body: "Agents transact autonomously over Circle nanopayments on Arc — sub-cent USDC, no human in the loop, settlement batched off-chain.",
    foot: "Arc · Circle",
  },
  {
    k: "Identity",
    color: "text-pfand-held",
    title: "One name, every chain",
    body: "Each agent resolves at <name>.agent8004.eth, carrying ENSIP-25/26 records served live from the index by a CCIP-Read gateway.",
    foot: "ENS",
  },
];

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-sm text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-signal/10 blur-[120px]" />
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
            <div className="flex flex-col justify-center">
              <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground shadow-soft-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
                ERC-8004 · x402 · ENS
              </div>
              <h1 className="font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.035em] text-foreground animate-in fade-in slide-in-from-bottom-3 duration-700 sm:text-6xl lg:text-7xl">
                Reputation you
                <br />
                can&rsquo;t fake,
                <br />
                <span className="text-signal-ink">because someone paid.</span>
                <PfandCursor className="ml-2 h-[0.78em] w-[0.12em] align-[-0.08em]" />
              </h1>
              <p
                className="mt-7 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground animate-in fade-in slide-in-from-bottom-3 duration-700 sm:text-lg"
                style={{ animationDelay: "120ms" }}
              >
                Pfand is a brokerage layer for the on-chain agent economy. Every job escrows a refundable
                deposit — your <span className="text-foreground">Pfand</span> — that the contract returns only when you
                post honest feedback on-chain. Feedback becomes costly to fake and cryptographically tied to a real payment.
              </p>
              <div
                className="mt-9 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-700"
                style={{ animationDelay: "220ms" }}
              >
                <Link
                  href="/demo"
                  className="rounded-xl bg-signal px-5 py-2.5 font-mono text-sm font-semibold whitespace-nowrap text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90"
                >
                  Run the loop →
                </Link>
                <Link
                  href="/explore"
                  className="rounded-xl border border-border bg-card px-5 py-2.5 font-mono text-sm whitespace-nowrap text-foreground shadow-soft-sm transition-colors hover:border-signal/40"
                >
                  Explore agents
                </Link>
              </div>
            </div>

            {/* Deposit receipt */}
            <div
              className="flex items-center animate-in fade-in slide-in-from-bottom-4 duration-1000"
              style={{ animationDelay: "200ms" }}
            >
              <DepositReceipt />
            </div>
          </div>

          {/* Stat band */}
          <div className="border-t border-border bg-card">
            <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-border sm:grid-cols-4">
              <Stat label="Agents indexed" value="—" />
              <Stat label="Feedback signals" value="—" />
              <Stat label="USDC escrowed" value="—" unit="USDC" />
              <Stat label="Pfand returned" value="—" unit="%" />
            </div>
          </div>
        </section>

        {/* The loop */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mb-10 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-ink">The loop</p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Feedback you reclaim, not feedback you give.
              </h2>
            </div>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-soft-sm md:grid-cols-4">
            {LOOP.map((step) => (
              <div key={step.n} className="flex flex-col gap-3 bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{step.n}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-signal-ink/80">{step.tag}</span>
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pillars */}
        <section className="border-t border-border bg-muted">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="grid gap-6 md:grid-cols-3">
              {PILLARS.map((p) => (
                <div key={p.k} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-7 shadow-soft-sm transition-colors hover:border-signal/40">
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${p.color}`}>{p.k}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{p.foot}</span>
                  </div>
                  <h3 className="font-display text-2xl font-semibold text-foreground">{p.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center font-display text-sm font-bold text-foreground">
            <span className="inline-flex items-baseline">
              Pfand
              <PfandCursor className="h-[12px] w-[5px]" />
            </span>
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">/ Broker8004</span>
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            ETHGlobal New York 2026 — ERC-8004 discovery, payments &amp; payment-backed reputation
          </span>
        </div>
      </footer>
    </>
  );
}

function DepositReceipt() {
  const rows = [
    { k: "agent", v: "audit-sol.agent8004.eth", accent: false },
    { k: "agentId", v: "#42", accent: false },
    { k: "fee", v: "100.00 USDC", accent: false },
    { k: "pfand (10%)", v: "10.00 USDC", accent: true },
  ];
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-2xl border border-border bg-muted" />
      <div className="relative rounded-2xl border border-border bg-card p-6 shadow-soft-lg">
        <div className="flex items-center justify-between border-b border-dashed border-border pb-4">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-foreground">
            Deposit Receipt
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">job #1138</span>
        </div>
        <dl className="space-y-2.5 py-4">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-4">
              <dt className="font-mono text-xs text-muted-foreground">{r.k}</dt>
              <dd
                className={cn(
                  "truncate font-mono text-xs",
                  r.accent ? "font-semibold text-signal-ink" : "text-foreground",
                )}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2 border-t border-dashed border-border pt-4">
          <StateRow label="Fee → service agent" state="released" />
          <StateRow label="Pfand deposit" state="held" />
          <StateRow label="On feedback posted" state="returned" />
        </div>
      </div>
    </div>
  );
}

function StateRow({ label, state }: { label: string; state: "released" | "held" | "returned" }) {
  const map = {
    released: { c: "text-muted-foreground", dot: "bg-muted-foreground", t: "RELEASED" },
    held: { c: "text-pfand-held", dot: "bg-pfand-held", t: "HELD" },
    returned: { c: "text-pfand-returned", dot: "bg-pfand-returned", t: "RETURNABLE" },
  }[state];
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${map.c}`}>
        <span className={`size-1.5 rounded-full ${map.dot}`} />
        {map.t}
      </span>
    </div>
  );
}
