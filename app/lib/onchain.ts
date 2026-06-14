/**
 * On-chain Arc actions for the Pfand broker loop, signed by the broker wallet
 * (BROKER_X402_KEY — the funded x402 wallet). Two things:
 *
 *   - postReview()  → ERC-8004 giveFeedback (the sign review: good/neutral/bad).
 *   - openEscrowJob() / claimRebate()  → the RebateEscrow Pfand bond, so a job
 *     is opened on hire and the deposit is released when the review lands.
 *
 * All best-effort: if env/keys are missing or a call reverts, callers surface
 * the error rather than crashing.
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reputationRegistryAbi, rebateEscrowAbi, erc20Abi } from "@pfand/shared";

const RPC = process.env.ARC_RPC_URL;
const REP = process.env.ARC_REPUTATION_REGISTRY as Hex | undefined;
const ESCROW = process.env.ARC_REBATE_ESCROW as Hex | undefined;
const USDC = process.env.ARC_USDC as Hex | undefined;
const KEY = process.env.BROKER_X402_KEY as Hex | undefined;

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC ?? ""] } },
} as const;

/** good = +1 vouch, neutral = 0, bad = −1 distrust. */
export const REVIEW_STATES = { good: 1, neutral: 0, bad: -1 } as const;
export type ReviewState = keyof typeof REVIEW_STATES;

export function onchainConfigured(): boolean {
  return Boolean(RPC && REP && KEY);
}

function clients() {
  const account = privateKeyToAccount(KEY!);
  const wallet = createWalletClient({
    account,
    chain: arcChain,
    transport: http(RPC),
  });
  const pub = createPublicClient({ chain: arcChain, transport: http(RPC) });
  return { account, wallet, pub };
}

export interface ReviewResult {
  txHash: string;
  client: string; // lowercased reviewer address (the broker wallet)
  value: number; // +1 / 0 / -1
  tag1: string; // task
  tag2: string; // state
}

/** Post an ERC-8004 sign review for `agentId` on Arc. */
export async function postReview(
  agentId: string,
  state: ReviewState,
  task: string,
  endpoint: string,
): Promise<ReviewResult> {
  const { account, wallet, pub } = clients();
  const value = BigInt(REVIEW_STATES[state]);
  const tag1 = (task || "general").slice(0, 40);
  const uri = `data:,Pfand broker review (${state}) for agent ${agentId}`;
  const feedbackHash = keccak256(toBytes(uri));
  const txHash = await wallet.writeContract({
    address: REP!,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [BigInt(agentId), value, 0, tag1, state, endpoint || "", uri, feedbackHash],
  });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return {
    txHash,
    client: account.address.toLowerCase(),
    value: Number(value),
    tag1,
    tag2: state,
  };
}

/**
 * Open a RebateEscrow job (escrows a 10% Pfand of `feeUsdc`). Returns the jobId.
 * feeUsdc=0 → pfand 0 (no USDC moved). Best-effort: approves USDC if a fee is set.
 */
export async function openEscrowJob(
  agentId: string,
  serviceWallet: string,
  feeUsdc = 0,
  feedbackWindowSecs = 86_400,
): Promise<{ jobId: string; txHash: string }> {
  const { wallet, pub } = clients();
  const fee = BigInt(Math.round(feeUsdc * 1_000_000)); // 6-dec USDC
  const pfand = (fee * 1000n) / 10000n;

  if (pfand > 0n && USDC && ESCROW) {
    const approveTx = await wallet.writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [ESCROW, pfand],
    });
    await pub.waitForTransactionReceipt({ hash: approveTx });
  }

  const txHash = await wallet.writeContract({
    address: ESCROW!,
    abi: rebateEscrowAbi,
    functionName: "openJob",
    args: [BigInt(agentId), serviceWallet as Hex, fee, BigInt(feedbackWindowSecs)],
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: txHash });
  let jobId = "";
  for (const log of rcpt.logs) {
    try {
      const d = decodeEventLog({
        abi: rebateEscrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (d.eventName === "JobOpened") {
        jobId = (d.args as { jobId: bigint }).jobId.toString();
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { jobId, txHash };
}

/** Claim the Pfand back for a job (requires fresh feedback to exist). */
export async function claimRebate(jobId: string): Promise<string> {
  const { wallet, pub } = clients();
  const txHash = await wallet.writeContract({
    address: ESCROW!,
    abi: rebateEscrowAbi,
    functionName: "claimRebate",
    args: [BigInt(jobId)],
  });
  await pub.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
