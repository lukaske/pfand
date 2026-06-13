import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { GatewayClient, type PayResult } from "@circle-fin/x402-batching/client";
import { ARC_CAIP2, CIRCLE_GATEWAY_TESTNET } from "@pfand/shared";
import { optionalEnv, normalizePrivateKey } from "./env.js";

/**
 * Thin wrappers over Circle's `@circle-fin/x402-batching` SDK (v3.x).
 *
 * Gas-free = Circle Gateway off-chain signed EIP-3009 authorizations against the
 * GatewayWallet, batched + settled by the facilitator. The buyer pays no gas;
 * the seller receives USDC. Network id for Arc Testnet is eip155:5042002.
 *
 * Docs / source confirmed from the published package types:
 *   - server: createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl }).require('$price')
 *   - client: new GatewayClient({ chain:'arcTestnet', privateKey }).pay(url, { method, body })
 * Reference repo: github.com/circlefin/arc-nanopayments
 */

/** Arc Testnet CAIP-2 id the middleware/client key on. */
export const ARC_NETWORK = ARC_CAIP2; // "eip155:5042002"

/** SDK's chain-name key for Arc Testnet (GATEWAY_DOMAINS.arcTestnet === 26). */
export const ARC_CHAIN_NAME = "arcTestnet" as const;

export function gatewayFacilitatorUrl(): string {
  return optionalEnv("CIRCLE_GATEWAY_URL") ?? CIRCLE_GATEWAY_TESTNET;
}

/**
 * Default SELLER wallet for the demo (the x402 `payTo`).
 *
 * CRITICAL: Circle Gateway rejects a payment whose `from` (buyer) equals `to`
 * (seller) with `invalidReason: "self_transfer"`. The single-key demo would
 * otherwise pay itself. So the seller must be a *distinct* address from the
 * buyer's PRIVATE_KEY. This is a receive-only address — the seller never signs
 * the x402 authorization and needs no gas or Gateway balance to receive — so a
 * fixed demo address is sufficient. Override with `SERVICE_WALLET`.
 */
export const DEMO_SELLER_WALLET = "0xAA5eD292454400F6A321e2581Aa420ea79E07671" as const;

export function resolveSellerWalletEnv(): `0x${string}` {
  const explicit = optionalEnv("SERVICE_WALLET");
  if (explicit) return explicit as `0x${string}`;
  // Fall back to the distinct demo seller so x402 never self-transfers.
  return DEMO_SELLER_WALLET;
}

/**
 * Build the seller-side x402 middleware factory. `gateway.require('$0.05')`
 * returns an Express-compatible middleware that 402s until the buyer presents a
 * valid Gateway-batched payment, then attaches `req.payment`.
 */
export function makeSellerGateway(sellerAddress: `0x${string}`) {
  return createGatewayMiddleware({
    sellerAddress,
    networks: ARC_NETWORK,
    facilitatorUrl: gatewayFacilitatorUrl(),
    description: "Pfand ERC-8004 service agent (Arc Testnet)",
  });
}

/**
 * Build the buyer-side Gateway client. Uses PRIVATE_KEY to sign the off-chain
 * authorization. `client.pay(url, { method, body })` runs the full 402 flow.
 */
export function makeBuyerGateway(privateKey: string, rpcUrl?: string): GatewayClient {
  return new GatewayClient({
    chain: ARC_CHAIN_NAME,
    privateKey: normalizePrivateKey(privateKey),
    ...(rpcUrl ? { rpcUrl } : {}),
  });
}

export type { PayResult };
