import { formatUnits, parseUnits } from "viem";
import { makeBuyerGateway } from "./lib/x402.js";
import { requireEnv, optionalEnv, isSimMode } from "./lib/env.js";
import { log } from "./lib/log.js";

/**
 * Fund the buyer's Circle Gateway balance.
 *
 * Circle Gateway nanopayments are gas-free for the *payment* because the buyer
 * signs an off-chain EIP-3009 `TransferWithAuthorization` against the
 * GatewayWallet contract. But the facilitator's `/v1/x402/verify` only accepts
 * that authorization if the buyer already holds a USDC balance *inside* the
 * GatewayWallet (domain 26 for Arc Testnet). With a zero Gateway balance,
 * `/verify` rejects and the seller middleware returns "Payment verification
 * failed".
 *
 * So before any payment we must do a ONE-TIME on-chain deposit:
 *   USDC.approve(GatewayWallet, amount)  →  GatewayWallet.deposit(USDC, amount)
 *
 * Both txs are handled inside the SDK's `client.deposit(...)`. After the deposit
 * lands, Circle's indexer credits the off-chain Gateway balance (queryable via
 * the Gateway `/v1/balances` API), and every subsequent `pay()` is gas-free.
 *
 * This helper is idempotent: it queries the current Gateway balance first and
 * skips the deposit if it already covers `minBalanceUsdc`.
 */

/** Default target Gateway balance to maintain (USDC, decimal string). */
const DEFAULT_MIN_BALANCE = "1.00";
/** Default amount to deposit when topping up (USDC, decimal string). */
const DEFAULT_DEPOSIT = "1.00";

export interface EnsureGatewayBalanceResult {
  /** Available Gateway balance after this call, in 6-dec base units. */
  available: bigint;
  /** Whether a deposit tx was actually sent this call. */
  deposited: boolean;
  /** approve tx hash, if one was sent. */
  approvalTxHash?: string;
  /** GatewayWallet.deposit tx hash, if one was sent. */
  depositTxHash?: string;
}

/**
 * Ensure the buyer has at least `minBalanceUsdc` available in the Circle Gateway
 * balance, depositing `depositUsdc` from its on-chain USDC if not. Idempotent.
 */
export async function ensureGatewayBalance(opts?: {
  minBalanceUsdc?: string;
  depositUsdc?: string;
}): Promise<EnsureGatewayBalanceResult> {
  const minBalanceUsdc = opts?.minBalanceUsdc ?? optionalEnv("GATEWAY_MIN_BALANCE_USDC") ?? DEFAULT_MIN_BALANCE;
  const depositUsdc = opts?.depositUsdc ?? optionalEnv("GATEWAY_DEPOSIT_USDC") ?? DEFAULT_DEPOSIT;
  const minBase = parseUnits(minBalanceUsdc, 6);

  const pk = requireEnv("PRIVATE_KEY");
  const rpcUrl = optionalEnv("ARC_RPC_URL");
  const gateway = makeBuyerGateway(pk, rpcUrl);

  // 1. Query current Gateway balance (off-chain, via Circle's /v1/balances API).
  let available = 0n;
  try {
    const bal = await gateway.getBalance();
    available = bal.available;
    log.detail("Gateway balance", `${bal.formattedAvailable} USDC available (depositor ${gateway.address})`);
  } catch (err) {
    // A fresh depositor returns "no balances" — treat as zero, not fatal.
    log.detail("Gateway balance", `0 USDC (no balance yet for ${gateway.address})`);
    available = 0n;
  }

  if (available >= minBase) {
    log.ok(`Gateway already funded (${formatUnits(available, 6)} ≥ ${minBalanceUsdc} USDC). Skipping deposit.`);
    return { available, deposited: false };
  }

  // 2. Deposit. SDK does approve(GatewayWallet) + GatewayWallet.deposit(USDC, amount).
  log.info(`Gateway balance below ${minBalanceUsdc} USDC — depositing ${depositUsdc} USDC (one-time, on-chain)…`);
  const dep = await gateway.deposit(depositUsdc);
  if (dep.approvalTxHash) log.tx("USDC approve(GatewayWallet)", dep.approvalTxHash);
  log.tx("GatewayWallet.deposit", dep.depositTxHash);
  log.money("Deposited to Gateway", `${dep.formattedAmount} USDC`);

  // 3. Re-query so the off-chain balance reflects the deposit (indexer may lag a
  //    few seconds; poll briefly).
  let after = available;
  for (let i = 0; i < 10; i++) {
    try {
      const bal = await gateway.getBalance();
      after = bal.available;
      if (after >= minBase) break;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log.detail("Gateway balance (post-deposit)", `${formatUnits(after, 6)} USDC available`);

  return {
    available: after,
    deposited: true,
    approvalTxHash: dep.approvalTxHash,
    depositTxHash: dep.depositTxHash,
  };
}

async function main() {
  log.banner("Pfand — fund Circle Gateway balance (buyer)");
  if (isSimMode()) {
    log.sim("Dry-run: would approve + deposit USDC into the Circle GatewayWallet (domain 26).");
    log.sim(`min balance ${optionalEnv("GATEWAY_MIN_BALANCE_USDC") ?? DEFAULT_MIN_BALANCE} USDC, deposit ${optionalEnv("GATEWAY_DEPOSIT_USDC") ?? DEFAULT_DEPOSIT} USDC`);
    return;
  }
  const res = await ensureGatewayBalance();
  log.banner(res.deposited ? "Gateway funded" : "Gateway already funded");
  log.detail("available", `${formatUnits(res.available, 6)} USDC`);
  if (res.depositTxHash) log.detail("deposit tx", res.depositTxHash);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
