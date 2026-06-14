import { getAddress } from "viem";
import { getArcClients } from "./lib/clients.js";
import { EscrowClient, loadEscrowAddresses } from "./lib/escrow.js";
import { makeBuyerGateway, type PayResult } from "./lib/x402.js";
import { ensureGatewayBalance } from "./deposit-gateway.js";
import { requireEnv, optionalEnv, isSimMode } from "./lib/env.js";
import { log, formatUsdc6, parseUsdc6 } from "./lib/log.js";

/**
 * Autonomous BUYER agent.
 *
 * Given a target (agentId + serviceWallet + endpoint), it:
 *   1. Pays the service call GAS-FREE via Circle x402 (off-chain signed,
 *      batch-settled by the Gateway facilitator).
 *   2. Runs the full Pfand escrow lifecycle with viem:
 *      approve → openJob → completeJob → giveFeedback → claimRebate,
 *   logging every tx hash and the deposit state (held → returned).
 *
 * The escrow is the enforcement mechanism: using an agent obliges you to leave
 * a SIGN-ONLY review (👍 success / 👎 fail). That review mints a trust-graph
 * edge, and the Pfand deposit returns the moment any fresh review lands.
 */

export interface HireTarget {
  agentId: bigint;
  serviceWallet: `0x${string}`;
  /** Full URL of the paid x402 endpoint, e.g. http://localhost:8402/audit */
  endpoint: string;
  /** Human USDC fee to escrow for the job (the service "price"). */
  feeUsdc: string;
  /** What to send the agent (Solidity source etc.). */
  input: string;
  /** Feedback score 0..100 the buyer posts after the work. */
  score: number;
  /** Honest outcome of the job. Defaults to success when score>=50. */
  outcome?: "success" | "fail";
  /** Task/skill being rated (tag1). Defaults to "audit". */
  taskTag?: string;
  /** Seconds the client has to post feedback before pfand can be forfeited. */
  feedbackWindowSecs: bigint;
}

/** Resolve the honest outcome: explicit, else derived from the score. */
function resolveOutcome(target: HireTarget): "success" | "fail" {
  return target.outcome ?? (target.score >= 50 ? "success" : "fail");
}

export interface HireResult {
  paid: PayResult | null;
  jobId: bigint | null;
  txHashes: {
    approve?: string;
    open?: string;
    complete?: string;
    feedback?: string;
    claim?: string;
    payment?: string;
  };
  pfandReturned: boolean;
}

/** Step 1: pay the x402 service call gas-free. Returns the work result + settlement tx. */
export async function payForService(
  endpoint: string,
  input: string,
): Promise<PayResult> {
  const pk = requireEnv("PRIVATE_KEY");
  const rpcUrl = optionalEnv("ARC_RPC_URL");
  const gateway = makeBuyerGateway(pk, rpcUrl);

  // Gas-free settlement requires a funded Gateway balance (the facilitator's
  // /verify rejects an off-chain authorization from a depositor with 0 balance).
  // This is a one-time on-chain deposit; idempotent, so it self-heals and is a
  // no-op once funded.
  await ensureGatewayBalance();

  log.info(`Paying ${endpoint} via Circle x402 (Gateway-batched, gas-free)…`);
  const result = await gateway.pay(endpoint, {
    method: "POST",
    body: { input },
  });
  log.money("x402 paid", formatUsdc6(result.amount));
  log.tx("x402 settlement", result.transaction);
  return result;
}

/** Step 2: run the escrow lifecycle for the (now-delivered) job. */
export async function runEscrowLifecycle(
  escrow: EscrowClient,
  target: HireTarget,
): Promise<HireResult> {
  const res: HireResult = { paid: null, jobId: null, txHashes: {}, pfandReturned: false };
  const fee = parseUsdc6(target.feeUsdc);
  const pfand = (fee * 1000n) / 10000n; // 10% PFAND_BPS
  const clientAddr = escrow.account.address;

  log.step("escrow", `Pfand bond — fee ${formatUsdc6(fee)} (paid via x402), pfand ${formatUsdc6(pfand)} (10% held)`);

  // approve only the Pfand bond (the fee was already paid gas-free via x402)
  const allowance = await escrow.usdcAllowance(clientAddr, loadEscrowAddresses().rebateEscrow);
  if (allowance < pfand) {
    res.txHashes.approve = await escrow.approve(pfand);
  } else {
    log.info(`USDC allowance already sufficient (${formatUsdc6(allowance)}).`);
  }

  // openJob — escrows only the 10% Pfand bond
  const opened = await escrow.openJob(
    target.agentId,
    target.serviceWallet,
    fee,
    target.feedbackWindowSecs,
  );
  res.jobId = opened.jobId;
  res.txHashes.open = opened.hash;
  log.info("Pfand bond escrowed (held pending fresh feedback):");
  await escrow.logDepositState(opened.jobId);

  // giveFeedback — a SIGN-ONLY review that mints a trust-graph edge and unlocks
  // the pfand. There is no magnitude: success → value 100 (positive edge),
  // fail → value 0 (negative edge), valueDecimals 0. The signal carries the
  // TASK (tag1) and the binary OUTCOME (tag2). Posting ANY fresh review — 👍 or
  // 👎 — refunds the bond; the deposit pays for the edge, not for a good rating.
  const outcome = resolveOutcome(target);
  const taskTag = target.taskTag ?? "audit";
  const idxBefore = await escrow.lastFeedbackIndex(target.agentId, clientAddr);
  res.txHashes.feedback = await escrow.giveFeedback({
    agentId: target.agentId,
    value: outcome === "success" ? 100n : 0n, // sign only: 100=👍, 0=👎
    valueDecimals: 0,
    tag1: taskTag, // task being reviewed
    tag2: outcome, // "success" | "fail" — the edge polarity
    endpoint: target.endpoint,
    feedbackURI: `pfand://job/${opened.jobId}/feedback`,
  });
  const idxAfter = await escrow.lastFeedbackIndex(target.agentId, clientAddr);
  log.ok(`Feedback posted (${taskTag} → ${outcome}, score ${target.score}/100), feedback index ${idxBefore} → ${idxAfter}.`);

  // claimRebate — returns the pfand iff this exact fresh feedback index exists and
  // hasn't already settled another job. idxAfter is the index just minted above.
  const claimable = await escrow.isRebateClaimable(opened.jobId, idxAfter);
  log.detail("isRebateClaimable", String(claimable));
  if (claimable) {
    res.txHashes.claim = await escrow.claimRebate(opened.jobId, idxAfter);
    res.pfandReturned = true;
    log.ok(`Pfand ${formatUsdc6(pfand)} reclaimed to client ${clientAddr}.`);
    await escrow.logDepositState(opened.jobId);
  } else {
    log.warn("Pfand not yet claimable (no fresh feedback detected).");
  }

  return res;
}

/** Full buyer flow: pay gas-free over x402, then run the on-chain Pfand bond loop. */
export async function hireAgent(target: HireTarget): Promise<HireResult> {
  // x402 payment is best-effort: the Circle Gateway facilitator needs a funded
  // Gateway balance (and possibly an API key). If it's not set up, we still run
  // the on-chain Pfand bond loop, which is the part that proves the mechanic.
  let paid: PayResult | null = null;
  try {
    paid = await payForService(target.endpoint, target.input);
  } catch (err) {
    log.warn(
      `x402 payment unavailable (${err instanceof Error ? err.message : String(err)}). ` +
        `Circle Gateway needs a funded balance / API key — proceeding with the on-chain Pfand bond loop.`,
    );
  }

  const { publicClient, walletClient } = getArcClients();
  const escrow = new EscrowClient(publicClient, walletClient, loadEscrowAddresses());
  const result = await runEscrowLifecycle(escrow, target);
  result.paid = paid;
  if (paid) result.txHashes.payment = paid.transaction;
  return result;
}

function targetFromEnv(): HireTarget {
  return {
    agentId: BigInt(requireEnv("TARGET_AGENT_ID")),
    serviceWallet: getAddress(requireEnv("TARGET_SERVICE_WALLET")),
    endpoint: requireEnv("TARGET_ENDPOINT"),
    feeUsdc: optionalEnv("TARGET_FEE_USDC") ?? "0.05",
    input:
      optionalEnv("TARGET_INPUT") ??
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Vault { mapping(address=>uint) bal; function withdraw() public { (bool ok,)=msg.sender.call{value:bal[msg.sender]}(\"\"); require(ok); bal[msg.sender]=0; } }",
    score: Number(optionalEnv("TARGET_SCORE") ?? "92"),
    outcome: optionalEnv("TARGET_OUTCOME") as "success" | "fail" | undefined,
    taskTag: optionalEnv("TARGET_TASK_TAG") ?? undefined,
    feedbackWindowSecs: BigInt(optionalEnv("FEEDBACK_WINDOW_SECS") ?? "86400"),
  };
}

async function main() {
  log.banner("Pfand client agent — autonomous buyer");
  if (isSimMode()) {
    const t = targetFromEnv_safe();
    log.sim("Dry-run: no chain calls. Intended actions:");
    log.sim(`pay x402 → ${t.endpoint} (~${t.feeUsdc} USDC fee, gas-free via Circle Gateway)`);
    log.sim(`approve pfand, openJob(agentId=${t.agentId}, serviceWallet=${t.serviceWallet}, fee=${t.feeUsdc}) → bonds 10%`);
    log.sim("giveFeedback → ERC-8004 signal; claimRebate → pfand returned");
    return;
  }
  const target = targetFromEnv();
  await hireAgent(target);
}

/** Env read that tolerates missing values for the --sim narrative. */
function targetFromEnv_safe(): HireTarget {
  const safe = (k: string, d: string) => optionalEnv(k) ?? d;
  return {
    agentId: BigInt(safe("TARGET_AGENT_ID", "1")),
    serviceWallet: getAddress(safe("TARGET_SERVICE_WALLET", "0x0000000000000000000000000000000000000001")),
    endpoint: safe("TARGET_ENDPOINT", "http://localhost:8402/audit"),
    feeUsdc: safe("TARGET_FEE_USDC", "0.05"),
    input: safe("TARGET_INPUT", "<solidity source>"),
    score: Number(safe("TARGET_SCORE", "92")),
    outcome: optionalEnv("TARGET_OUTCOME") as "success" | "fail" | undefined,
    taskTag: optionalEnv("TARGET_TASK_TAG") ?? undefined,
    feedbackWindowSecs: BigInt(safe("FEEDBACK_WINDOW_SECS", "86400")),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
