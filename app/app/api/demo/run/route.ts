import { NextResponse } from "next/server";
import { getAgent } from "@/lib/seed";
import type {
  DemoOutcome,
  DemoRunRequest,
  DemoRunResponse,
  DemoStep,
} from "@/lib/demo-types";

/** Stable demo tx hash generator (replace with real Arc receipts later). */
function tx(seed: string): string {
  let h = 0n;
  for (const c of seed)
    h = (h * 1099511628211n + BigInt(c.charCodeAt(0))) & ((1n << 256n) - 1n);
  return "0x" + h.toString(16).padStart(64, "0");
}

const CLIENT = "0x" + "a1c3".padEnd(40, "0");

export async function POST(req: Request) {
  let outcome: DemoOutcome = "success";
  try {
    const body = (await req.json()) as DemoRunRequest;
    if (body?.outcome === "fail" || body?.outcome === "success") {
      outcome = body.outcome;
    }
  } catch {
    // no/invalid body → default to "success"
  }
  const ok = outcome === "success";

  // Hero agent for the scripted loop.
  const agent = getAgent("42");
  const fee = agent?.priceUsdc ?? 100;
  const pfand = Number((fee * 0.1).toFixed(2));
  const jobId = String(1138 + Math.floor(Math.random() * 900));
  const ens = agent?.ensName ?? "audit-sol.agent8004.eth";
  const scoreBefore =
    agent?.reputation.trustRank ?? agent?.reputation.scoreNormalized ?? 95;
  // An honest signal nudges the rolling score: up on success, down on fail.
  const scoreAfter = ok
    ? Math.min(100, scoreBefore + 1)
    : Math.max(0, scoreBefore - 1);

  const steps: DemoStep[] = [
    {
      kind: "discover",
      index: "01",
      label: "Discover",
      detail: `Resolved ${ens} from the ERC-8004 index — top reputation for solidity-audit.`,
      tag: "ENS · BigQuery",
      txHash: null,
      gasFree: true,
      deposit: "none",
      fee: "pending",
    },
    {
      kind: "pay",
      index: "02",
      label: "Pay over x402",
      detail: `Pays the ${fee.toFixed(2)} USDC fee gas-free via x402 nanopayments; the agent returns a Claude-backed audit. No gas, no human in the loop.`,
      tag: "Circle · x402",
      txHash: tx(`${jobId}-pay`),
      gasFree: true,
      deposit: "none",
      fee: "released",
    },
    {
      kind: "openJob",
      index: "03",
      label: "Escrow Pfand",
      detail: `RebateEscrow locks a ${pfand.toFixed(2)} USDC Pfand — the deposit that obliges you to review. It's 10% of the fee, and the fee itself never touches the escrow.`,
      tag: "RebateEscrow",
      txHash: tx(`${jobId}-open`),
      gasFree: false,
      deposit: "held",
      fee: "released",
    },
    {
      kind: "giveFeedback",
      index: "04",
      label: ok ? "Sign review: 👍 success" : "Sign review: 👎 fail",
      detail: ok
        ? "You post a 👍 sign review on-chain (value 100, tag2=success) — cryptographically tied to this job. This MINTS a positive edge in the TrustRank graph."
        : "You post a 👎 sign review on-chain (value 0, tag2=fail) — cryptographically tied to this job. This MINTS a negative edge in the TrustRank graph.",
      tag: "ReputationRegistry",
      txHash: tx(`${jobId}-feedback`),
      gasFree: false,
      deposit: "held",
      fee: "released",
    },
    {
      kind: "claimRebate",
      index: "05",
      label: "Pfand returns",
      detail: `Fresh review verified on-chain → the ${pfand.toFixed(2)} USDC Pfand is returned in full. The deposit refunds the moment you review — 👍 or 👎 alike.`,
      tag: "RebateEscrow",
      txHash: tx(`${jobId}-claim`),
      gasFree: false,
      deposit: "returned",
      fee: "released",
    },
  ];

  const body: DemoRunResponse = {
    receipt: {
      jobId,
      agentId: agent?.agentId ?? "42",
      agentName: agent?.name ?? "AuditSol",
      ensName: ens,
      network: agent?.network ?? "arc",
      client: CLIENT,
      feeUsdc: fee,
      pfandUsdc: pfand,
      scoreBefore,
      scoreAfter,
      outcome,
    },
    steps,
  };

  return NextResponse.json(body);
}
