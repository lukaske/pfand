"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Play, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { DepositReceipt } from "@/components/deposit-receipt";
import { PfandCursor } from "@/components/pfand-cursor";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDemoRun } from "@/lib/api";
import type {
  DemoReceipt,
  DemoStep,
  DepositState,
  FeeState,
} from "@/lib/demo-types";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "done";

const STEP_MS = 1100;

export default function DemoPage() {
  const demo = useDemoRun();
  const [steps, setSteps] = useState<DemoStep[]>([]);
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null);
  const [active, setActive] = useState(-1); // index currently executing
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const run = useCallback(async () => {
    clearTimers();
    setPhase("running");
    setActive(-1);
    setSteps([]);
    setReceipt(null);

    const data = await demo.mutateAsync();
    setSteps(data.steps);
    setReceipt(data.receipt);

    // Drive the stepper: each step "executes" in sequence.
    data.steps.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => setActive(i), i * STEP_MS),
      );
    });
    timers.current.push(
      setTimeout(() => {
        setActive(data.steps.length);
        setPhase("done");
        toast.success("Pfand returned in full", {
          description: `Job #${data.receipt.jobId} settled · reputation +1`,
        });
      }, data.steps.length * STEP_MS),
    );
  }, [demo]);

  // Resolve the receipt state from the highest completed step.
  const completedThrough = Math.min(active, steps.length - 1);
  let fee: FeeState = "pending";
  let deposit: DepositState = "none";
  if (completedThrough >= 0 && steps[completedThrough]) {
    fee = steps[completedThrough].fee;
    deposit = steps[completedThrough].deposit;
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2 text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-ink">
            The Pfand loop · live on Arc
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            One job. One deposit. Reputation you can&rsquo;t fake.
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Watch an agent discover, pay gas-free over x402, escrow a refundable
            Pfand, complete the job, post on-chain feedback, and reclaim the
            deposit — end to end.
          </p>
        </div>

        {/* Run controls */}
        <div className="mt-8 flex items-center justify-center gap-3">
          {phase === "idle" ? (
            <button
              type="button"
              onClick={run}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-signal px-6 font-mono text-sm font-semibold whitespace-nowrap text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90"
            >
              <Play className="h-4 w-4" /> Run the loop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={phase === "running"}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-6 font-mono text-sm whitespace-nowrap text-foreground shadow-soft-sm transition-colors hover:border-signal/40 disabled:opacity-50"
            >
              {phase === "running" ? (
                <>
                  running
                  <PfandCursor className="h-[14px] w-[7px]" />
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Run again
                </>
              )}
            </button>
          )}
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Stepper */}
          <div className="relative">
            {steps.length === 0 ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border text-center">
                <PfandCursor className="h-8 w-3" />
                <p className="font-mono text-sm text-muted-foreground">
                  Press run to execute the lifecycle.
                </p>
              </div>
            ) : (
              <ol className="relative flex flex-col">
                {/* vertical rail */}
                <span className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
                {steps.map((s, i) => (
                  <StepRow
                    key={s.kind}
                    step={s}
                    state={
                      i < active ? "done" : i === active ? "active" : "pending"
                    }
                  />
                ))}
              </ol>
            )}
          </div>

          {/* Live receipt + reputation */}
          <div className="flex flex-col gap-6">
            {receipt ? (
              <>
                <DepositReceipt
                  receipt={receipt}
                  fee={fee}
                  deposit={deposit}
                  className="animate-in fade-in slide-in-from-bottom-3 duration-700"
                />
                <ReputationCard receipt={receipt} done={phase === "done"} />
              </>
            ) : (
              <Card className="items-center justify-center gap-3 rounded-2xl p-10 text-center shadow-soft-sm">
                <PfandCursor className="h-7 w-2.5" />
                <p className="font-mono text-xs text-muted-foreground">
                  The deposit receipt updates here as the loop runs.
                </p>
              </Card>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function StepRow({
  step,
  state,
}: {
  step: DemoStep;
  state: "pending" | "active" | "done";
}) {
  return (
    <li
      className={cn(
        "relative flex gap-4 pb-6 pl-0 transition-opacity duration-500",
        state === "pending" && "opacity-40",
      )}
    >
      {/* node */}
      <div
        className={cn(
          "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background transition-colors duration-500",
          state === "done" && "border-pfand-returned text-pfand-returned",
          state === "active" && "border-signal text-signal",
          state === "pending" && "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? (
          <Check className="h-4 w-4" />
        ) : state === "active" ? (
          <PfandCursor className="h-[14px] w-[6px]" />
        ) : (
          <span className="font-mono text-[10px]">{step.index}</span>
        )}
      </div>

      <div
        className={cn(
          "flex-1 rounded-2xl border bg-card p-4 transition-all duration-500",
          state === "active"
            ? "border-signal/40 shadow-soft-md"
            : "border-border shadow-soft-sm",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-semibold text-foreground">
              {step.label}
            </h3>
            {step.gasFree && (
              <Badge
                variant="outline"
                className="gap-1 border-transparent bg-signal-wash font-mono text-[9px] uppercase tracking-wider text-signal-ink"
              >
                <Zap className="h-2.5! w-2.5!" /> gas-free
              </Badge>
            )}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-signal-ink/80">
            {step.tag}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.detail}
        </p>
        {step.txHash && state !== "pending" && (
          <a
            href={`https://explorer.arc.network/tx/${step.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-signal-ink"
          >
            {shortAddress(step.txHash, 10, 8)}
            <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

function ReputationCard({
  receipt,
  done,
}: {
  receipt: DemoReceipt;
  done: boolean;
}) {
  const shown = done ? receipt.scoreAfter : receipt.scoreBefore;
  return (
    <Card className="gap-4 rounded-2xl p-5 shadow-soft-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {receipt.agentName} reputation
        </span>
        {done && (
          <Badge
            variant="outline"
            className="gap-1 border-pfand-returned/30 font-mono text-[10px] text-pfand-returned"
          >
            +1 signal
          </Badge>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span
          className={cn(
            "font-mono text-4xl font-semibold tabular-nums transition-colors duration-700",
            done ? "text-pfand-returned" : "text-foreground",
          )}
        >
          {shown}
        </span>
        <span className="mb-1.5 font-mono text-xs text-muted-foreground">
          / 100
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-pfand-returned transition-all duration-1000"
          style={{ width: `${shown}%` }}
        />
      </div>
      <div className="flex flex-col gap-1 border-t border-dashed border-border pt-3 font-mono text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>ENS record</span>
          <span className="text-foreground">{receipt.ensName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>agent-registration</span>
          <span
            className={cn(
              "transition-colors duration-700",
              done ? "text-pfand-returned" : "text-muted-foreground",
            )}
          >
            {done ? "updated ✓" : "pending"}
          </span>
        </div>
      </div>
    </Card>
  );
}
