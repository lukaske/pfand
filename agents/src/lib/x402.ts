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
