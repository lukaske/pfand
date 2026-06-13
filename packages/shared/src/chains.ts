import { defineChain } from "viem";
import { sepolia, mainnet } from "viem/chains";

/**
 * Arc Testnet — Circle's stablecoin L1. Native gas token is USDC.
 * Note: the native gas unit reports 18 decimals at the RPC layer, but the USDC
 * ERC-20 interface (token transfers, x402 amounts) uses 6 decimals.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"], webSocket: ["wss://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export { sepolia, mainnet };

/** CAIP-2 network id used by Circle x402 / nanopayments. */
export const ARC_CAIP2 = "eip155:5042002";
