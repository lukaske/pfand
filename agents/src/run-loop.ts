import type { Server } from "node:http";
import { getAddress } from "viem";
import { isSimMode, optionalEnv } from "./lib/env.js";
import { log, formatUsdc6, parseUsdc6 } from "./lib/log.js";
import { buildServiceApp } from "./service-agent.js";
import { seedAgents } from "./seed-agents.js";
import { hireAgent, type HireTarget } from "./client-agent.js";

/**
 * End-to-end demo loop for the AUTONOMOUS AGENT PAYMENT LOOP on Arc Testnet.
 *
 * Narrative:
 *   1. Seller agent comes online (x402-protected Claude service).
 *   2. Seed: register service agents in the ERC-8004 IdentityRegistry.
 *   3. Buyer agent hires the auditor:
 *        a. pays the call GAS-FREE via Circle x402 (Gateway-batched settlement),
 *        b. escrows fee + 10% pfand, releases the fee, posts ERC-8004 feedback,
 *           and reclaims the pfand — every tx hash + deposit state printed.
 *
 * `--sim` runs the whole narrative with NO chain/network calls (safe with no
 * funded Arc key) by printing intended actions.
 */

function startSellerInProcess(): { server: Server; baseUrl: string; sellerWallet: `0x${string}` } {
  const { app, port, sellerWallet, baseUrl } = buildServiceApp();
  const server = app.listen(port);
  log.ok(`Service agent online at ${baseUrl} (seller wallet ${sellerWallet}).`);
  return { server, baseUrl, sellerWallet };
}

async function runSim() {
  log.banner("Pfand — autonomous agent payment loop (SIM)");
  log.step(1, "Service (seller) agent");
  log.sim("Would expose POST /audit, /optimize, /document behind Circle x402 middleware.");
  log.sim("Each call 402s until a gas-free Gateway-batched payment is presented, then Claude does the work.");

  log.step(2, "Seed ERC-8004 agents");
  const seeded = await seedAgents(); // sim-aware: writes cards, no chain

  const auditor = seeded.find((s) => s.persona.slug === "solidity-auditor") ?? seeded[0]!;
  const fee = optionalEnv("TARGET_FEE_USDC") ?? "0.05";
  const pfand = formatUsdc6((parseUsdc6(fee) * 1000n) / 10000n);

  log.step(3, "Buyer agent hires the auditor");
  log.sim(`pay x402 → ${auditor.persona.route} (~${fee} USDC, GAS-FREE via Circle Gateway eip155:5042002)`);
  log.sim(`approve ${fee} USDC + pfand; openJob(agentId=${auditor.agentId ?? "<id>"}, serviceWallet=${auditor.serviceWallet}, fee=${fee})`);
  log.sim(`completeJob → fee ${formatUsdc6(parseUsdc6(fee))} released to seller`);
  log.sim("giveFeedback (ERC-8004 ReputationRegistry) → fresh on-chain signal");
  log.sim(`claimRebate → pfand ${pfand} returned to buyer (forfeited to treasury only if no fresh feedback)`);

  log.banner("SIM complete — set Arc creds + funded key, then run without --sim");
}

async function runLive() {
  log.banner("Pfand — autonomous agent payment loop (Arc Testnet)");

  // 1. Seller online (in-process unless an external SERVICE_BASE_URL is given).
  let server: Server | undefined;
  let baseUrl: string;
  let sellerWallet: `0x${string}`;
  const externalBase = optionalEnv("SERVICE_BASE_URL");
  log.step(1, "Service (seller) agent");
  if (externalBase) {
    baseUrl = externalBase.replace(/\/$/, "");
    sellerWallet = getAddress(optionalEnv("SERVICE_WALLET") ?? "0x0000000000000000000000000000000000000000");
    log.info(`Using external service agent at ${baseUrl}.`);
  } else {
    const s = startSellerInProcess();
    server = s.server;
    baseUrl = s.baseUrl;
    sellerWallet = s.sellerWallet;
  }

  try {
    // 2. Seed agents on-chain.
    log.step(2, "Register ERC-8004 agents");
    const seeded = await seedAgents();
    const auditor = seeded.find((s) => s.persona.slug === "solidity-auditor") ?? seeded[0]!;
    if (auditor.agentId === null) throw new Error("Seeding did not return an agentId (live mode expected one).");

    // 3. Buyer hires the auditor.
    log.step(3, "Buyer agent hires the auditor");
    const target: HireTarget = {
      agentId: auditor.agentId,
      serviceWallet: auditor.serviceWallet,
      endpoint: `${baseUrl}${auditor.persona.route}`,
      feeUsdc: optionalEnv("TARGET_FEE_USDC") ?? "0.05",
      input:
        optionalEnv("TARGET_INPUT") ??
        "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Vault { mapping(address=>uint) bal; function withdraw() public { (bool ok,)=msg.sender.call{value:bal[msg.sender]}(\"\"); require(ok); bal[msg.sender]=0; } }",
      score: Number(optionalEnv("TARGET_SCORE") ?? "92"),
      feedbackWindowSecs: BigInt(optionalEnv("FEEDBACK_WINDOW_SECS") ?? "86400"),
    };
    const result = await hireAgent(target);

    log.banner("Loop complete");
    log.detail("jobId", String(result.jobId));
    log.detail("x402 settlement", result.txHashes.payment ?? "—");
    log.detail("openJob", result.txHashes.open ?? "—");
    log.detail("completeJob", result.txHashes.complete ?? "—");
    log.detail("giveFeedback", result.txHashes.feedback ?? "—");
    log.detail("claimRebate", result.txHashes.claim ?? "—");
    log.ok(result.pfandReturned ? "Pfand returned to the buyer." : "Pfand not reclaimed (see logs).");
  } finally {
    server?.close();
  }
}

async function main() {
  if (isSimMode()) {
    await runSim();
  } else {
    await runLive();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
