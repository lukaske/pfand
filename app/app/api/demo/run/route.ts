import { NextResponse } from "next/server";
import { getAgent } from "@/lib/seed";
import type { DemoRunResponse, DemoStep } from "@/lib/demo-types";

/** Stable demo tx hash generator (replace with real Arc receipts later). */
function tx(seed: string): string {
  let h = 0n;
  for (const c of seed)
    h = (h * 1099511628211n + BigInt(c.charCodeAt(0))) & ((1n << 256n) - 1n);
  return "0x" + h.toString(16).padStart(64, "0");
}

const CLIENT = "0x" + "a1c3".padEnd(40, "0");

export async function POST() {
  // Hero agent for the scripted loop.
  const agent = getAgent("42");
  const fee = agent?.priceUsdc ?? 100;
  const pfand = Number((fee * 0.1).toFixed(2));
  const jobId = String(1138 + Math.floor(Math.random() * 900));
  const ens = agent?.ensName ?? "audit-sol.broker8004.eth";
  const scoreBefore = agent?.reputation.scoreNormalized ?? 95;
  // honest feedback nudges the rolling score a hair.
  const scoreAfter = Math.min(100, scoreBefore + 1);

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
      label: "Post Pfand bond",
      detail: `RebateEscrow locks a ${pfand.toFixed(2)} USDC Pfand — the honesty bond, 10% of the fee. The fee itself never touches the escrow.`,
      tag: "RebateEscrow",
      txHash: tx(`${jobId}-open`),
      gasFree: false,
      deposit: "held",
      fee: "released",
    },
    {
      kind: "giveFeedback",
      index: "04",
      label: "Give feedback",
      detail: "Client posts an on-chain NewFeedback signal — cryptographically tied to this paid job.",
      tag: "ReputationRegistry",
      txHash: tx(`${jobId}-feedback`),
      gasFree: false,
      deposit: "held",
      fee: "released",
    },
    {
      kind: "claimRebate",
      index: "05",
      label: "Reclaim Pfand",
      detail: `Fresh feedback verified on-chain → the ${pfand.toFixed(2)} USDC Pfand is returned in full.`,
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
    },
    steps,
  };

  return NextResponse.json(body);
}
