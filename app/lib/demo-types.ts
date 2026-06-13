/**
 * Contract for the scripted Pfand job lifecycle returned by /api/demo/run.
 * Structured so a real Arc orchestrator can populate the same shape from live
 * tx receipts (txHash, deposit state transitions) without UI changes.
 */

import type { AgentNetwork } from "@pfand/shared";

export type DemoStepKind =
  | "discover"
  | "pay"
  | "openJob"
  | "completeJob"
  | "giveFeedback"
  | "claimRebate";

/** Honest rating outcome the client posts on-chain. */
export type DemoOutcome = "success" | "fail";

/** Request body for /api/demo/run. */
export interface DemoRunRequest {
  /** Which way the client rates the job. Defaults to "success". */
  outcome?: DemoOutcome;
}

/** Deposit lifecycle as the contract sees it. */
export type DepositState = "none" | "held" | "returned" | "forfeited";

/** Fee leg lifecycle. */
export type FeeState = "pending" | "released";

export interface DemoStep {
  kind: DemoStepKind;
  /** Ordinal label e.g. "01". */
  index: string;
  label: string;
  /** One-line human description of what happens on-chain. */
  detail: string;
  /** Right-hand metadata chip (protocol / venue). */
  tag: string;
  /** Fake-but-plausible Arc tx hash (null for the off-chain discovery step). */
  txHash: string | null;
  /** True when this leg is paid gas-free via x402 nanopayments. */
  gasFree: boolean;
  /** Deposit state AFTER this step executes. */
  deposit: DepositState;
  /** Fee state AFTER this step executes. */
  fee: FeeState;
}

export interface DemoReceipt {
  jobId: string;
  agentId: string;
  agentName: string;
  ensName: string;
  network: AgentNetwork;
  client: string;
  /** human USDC */
  feeUsdc: number;
  /** human USDC */
  pfandUsdc: number;
  /** reputation score before / after this job's feedback lands */
  scoreBefore: number;
  scoreAfter: number;
  /** Honest outcome the client posted (success or fail). */
  outcome: DemoOutcome;
}

export interface DemoRunResponse {
  receipt: DemoReceipt;
  steps: DemoStep[];
}
