import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@pfand/shared";
import { optionalEnv, requireEnv, normalizePrivateKey } from "./env.js";

/**
 * viem clients for Arc Testnet, built strictly from env.
 *
 * ARC_RPC_URL  — optional; defaults to the public Arc Testnet RPC from the chain def.
 * PRIVATE_KEY  — required for the wallet client (the agent / client signer).
 */

export function getRpcUrl(): string {
  return optionalEnv("ARC_RPC_URL") ?? arcTestnet.rpcUrls.default.http[0];
}

export function getPublicClient(): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(getRpcUrl()),
  }) as PublicClient<Transport, Chain>;
}

export function getAccount(): Account {
  return privateKeyToAccount(normalizePrivateKey(requireEnv("PRIVATE_KEY")));
}

export function getWalletClient(account: Account = getAccount()): WalletClient<Transport, Chain, Account> {
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(getRpcUrl()),
  });
}

/** Bundle commonly used together. */
export interface ArcClients {
  account: Account;
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
  rpcUrl: string;
}

export function getArcClients(): ArcClients {
  const account = getAccount();
  return {
    account,
    publicClient: getPublicClient(),
    walletClient: getWalletClient(account),
    rpcUrl: getRpcUrl(),
  };
}
