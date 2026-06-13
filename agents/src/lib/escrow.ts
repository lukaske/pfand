import {
  keccak256,
  toHex,
  decodeEventLog,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  rebateEscrowAbi,
  reputationRegistryAbi,
  erc20Abi,
  loadArcDeployment,
} from "@pfand/shared";
import { env } from "./env.js";
import { log, formatUsdc6 } from "./log.js";

/**
 * Viem wrapper around the Pfand escrow lifecycle:
 *   approve(pfand) → openJob → giveFeedback → claimRebate.
 *
 * The service fee is paid out-of-band gas-free over x402; the escrow only holds
 * the 10% Pfand bond. Every method logs its tx hash and the resulting deposit
 * state. Reads use `jobs(jobId)` and `isRebateClaimable(jobId)` to narrate
 * held → returned.
 */

export interface EscrowAddresses {
  rebateEscrow: `0x${string}`;
  reputationRegistry: `0x${string}`;
  usdc: `0x${string}`;
}

export function loadEscrowAddresses(): EscrowAddresses {
  const d = loadArcDeployment(env);
  return {
    rebateEscrow: d.rebateEscrow,
    reputationRegistry: d.reputationRegistry,
    usdc: d.usdc,
  };
}

export interface JobState {
  client: `0x${string}`;
  serviceWallet: `0x${string}`;
  agentId: bigint;
  fee: bigint;
  pfand: bigint;
  feedbackIndexAtOpen: bigint;
  feedbackDeadline: bigint;
  status: number; // 0 None, 1 Open, 2 Settled
}

const STATUS_NAMES = ["None", "Open", "Settled"] as const;

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? `Unknown(${status})`;
}

export class EscrowClient {
  constructor(
    private readonly publicClient: PublicClient<Transport, Chain>,
    private readonly walletClient: WalletClient<Transport, Chain, Account>,
    private readonly addr: EscrowAddresses,
  ) {}

  get account(): Account {
    return this.walletClient.account;
  }

  async usdcBalance(owner: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addr.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  }

  async usdcAllowance(owner: `0x${string}`, spender: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addr.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
  }

  /** Approve the escrow to pull the Pfand bond. Returns the tx hash. */
  async approve(amount: bigint): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.addr.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.addr.rebateEscrow, amount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    log.tx("approve USDC", hash);
    return hash;
  }

  /**
   * openJob(agentId, serviceWallet, fee, feedbackWindow). Escrows only the 10%
   * Pfand bond (the fee is paid out-of-band via x402). Returns { jobId, hash }.
   */
  async openJob(
    agentId: bigint,
    serviceWallet: `0x${string}`,
    fee: bigint,
    feedbackWindow: bigint,
  ): Promise<{ jobId: bigint; hash: `0x${string}` }> {
    const hash = await this.walletClient.writeContract({
      address: this.addr.rebateEscrow,
      abi: rebateEscrowAbi,
      functionName: "openJob",
      args: [agentId, serviceWallet, fee, feedbackWindow],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    log.tx("openJob", hash);

    const jobId = this.extractJobId(receipt.logs);
    log.detail("jobId", jobId.toString());
    return { jobId, hash };
  }

  /**
   * giveFeedback on the ReputationRegistry. value is signed fixed-point
   * (e.g. 92 with valueDecimals 0 => "92"). feedbackURI/hash optional.
   */
  async giveFeedback(args: {
    agentId: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    feedbackURI: string;
  }): Promise<`0x${string}`> {
    const feedbackHash = args.feedbackURI
      ? keccak256(toHex(args.feedbackURI))
      : ("0x" + "0".repeat(64) as `0x${string}`);

    const hash = await this.walletClient.writeContract({
      address: this.addr.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [
        args.agentId,
        args.value,
        args.valueDecimals,
        args.tag1,
        args.tag2,
        args.endpoint,
        args.feedbackURI,
        feedbackHash,
      ],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    log.tx("giveFeedback", hash);
    return hash;
  }

  /** claimRebate(jobId): returns the pfand iff fresh non-revoked feedback exists. */
  async claimRebate(jobId: bigint): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.addr.rebateEscrow,
      abi: rebateEscrowAbi,
      functionName: "claimRebate",
      args: [jobId],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    log.tx("claimRebate", hash);
    return hash;
  }

  async isRebateClaimable(jobId: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addr.rebateEscrow,
      abi: rebateEscrowAbi,
      functionName: "isRebateClaimable",
      args: [jobId],
    });
  }

  async getJob(jobId: bigint): Promise<JobState> {
    const j = await this.publicClient.readContract({
      address: this.addr.rebateEscrow,
      abi: rebateEscrowAbi,
      functionName: "jobs",
      args: [jobId],
    });
    return {
      client: j[0],
      serviceWallet: j[1],
      agentId: j[2],
      fee: j[3],
      pfand: j[4],
      feedbackIndexAtOpen: j[5],
      feedbackDeadline: j[6],
      status: j[7],
    };
  }

  async lastFeedbackIndex(agentId: bigint, clientAddr: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addr.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getLastIndex",
      args: [agentId, clientAddr],
    });
  }

  /** Pretty-print the on-chain deposit state for the narrative. */
  async logDepositState(jobId: bigint): Promise<JobState> {
    const j = await this.getJob(jobId);
    log.detail("status", statusName(j.status));
    log.money("fee (paid via x402)", formatUsdc6(j.fee));
    log.money("pfand (held)", formatUsdc6(j.pfand));
    return j;
  }

  private extractJobId(logs: readonly { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }[]): bigint {
    for (const lg of logs) {
      if (lg.address.toLowerCase() !== this.addr.rebateEscrow.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: rebateEscrowAbi,
          data: lg.data,
          topics: lg.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "JobOpened") {
          return (decoded.args as { jobId: bigint }).jobId;
        }
      } catch {
        /* not a RebateEscrow event we know; skip */
      }
    }
    throw new Error("JobOpened event not found in receipt logs");
  }
}
