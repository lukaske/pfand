"use client";

import type { DemoReceipt, DepositState, FeeState } from "@/lib/demo-types";
import { formatUsdc, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

function depositMeta(state: DepositState) {
  return {
    none: { c: "text-muted-foreground", dot: "bg-muted-foreground", t: "PENDING" },
    held: { c: "text-pfand-held", dot: "bg-pfand-held", t: "HELD" },
    returned: { c: "text-pfand-returned", dot: "bg-pfand-returned", t: "RETURNED" },
    forfeited: { c: "text-pfand-forfeited", dot: "bg-pfand-forfeited", t: "FORFEITED" },
  }[state];
}

function feeMeta(state: FeeState) {
  return {
    pending: { c: "text-muted-foreground", dot: "bg-muted-foreground", t: "ESCROWED" },
    released: { c: "text-pfand-returned", dot: "bg-pfand-returned", t: "RELEASED" },
  }[state];
}

function StateRow({
  label,
  c,
  dot,
  t,
}: {
  label: string;
  c: string;
  dot: string;
  t: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px]", c)}>
        <span className={cn("size-1.5 rounded-full transition-colors", dot)} />
        {t}
      </span>
    </div>
  );
}

export function DepositReceipt({
  receipt,
  fee,
  deposit,
  className,
}: {
  receipt: DemoReceipt;
  fee: FeeState;
  deposit: DepositState;
  className?: string;
}) {
  const f = feeMeta(fee);
  const d = depositMeta(deposit);

  const rows = [
    { k: "agent", v: receipt.ensName, accent: false },
    { k: "agentId", v: `#${receipt.agentId}`, accent: false },
    { k: "client", v: shortAddress(receipt.client), accent: false },
    { k: "fee", v: `${formatUsdc(receipt.feeUsdc * 1_000_000)} USDC`, accent: false },
    {
      k: "pfand (10%)",
      v: `${formatUsdc(receipt.pfandUsdc * 1_000_000)} USDC`,
      accent: true,
    },
  ];

  return (
    <div className={cn("relative w-full", className)}>
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-2xl border border-border bg-muted" />
      <div className="relative rounded-2xl border border-border bg-card p-6 shadow-soft-lg">
        <div className="flex items-center justify-between border-b border-dashed border-border pb-4">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-foreground">
            Deposit Receipt
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            job #{receipt.jobId}
          </span>
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
          <StateRow label="Fee → service agent" {...f} />
          <StateRow label="Pfand deposit" {...d} />
        </div>
      </div>
    </div>
  );
}
