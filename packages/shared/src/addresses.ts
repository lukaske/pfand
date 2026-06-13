/**
 * Canonical, verified contract addresses. Re-confirm before mainnet/testnet use.
 */

/** ERC-8004 canonical registries on Ethereum MAINNET (deterministic across ~30 chains). */
export const ERC8004_MAINNET = {
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  // No ValidationRegistry on mainnet (spec under active TEE discussion).
} as const;

/** ChaosChain reference-impl deployment on Ethereum SEPOLIA (incl. ValidationRegistry). */
export const ERC8004_SEPOLIA = {
  identityRegistry: "0xf66e7CBdAE1Cb710fee7732E4e1f173624e137A7",
  reputationRegistry: "0x6E2a285294B5c74CB76d76AB77C1ef15c2A9E407",
  validationRegistry: "0xC26171A3c4e1d958cEA196A5e84B7418C58DCA2C",
} as const;

/** Arc Testnet system + Circle addresses. */
export const ARC = {
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

/** Circle nanopayments / Gateway testnet facilitator endpoint. */
export const CIRCLE_GATEWAY_TESTNET = "https://gateway-api-testnet.circle.com";

/**
 * Our own ERC-8004 + RebateEscrow deployment on Arc Testnet.
 * Filled by the deploy script; read from env at runtime so nothing is hard-coded
 * before deployment. See contracts/script/Deploy.s.sol.
 */
export interface PfandDeployment {
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry: `0x${string}`;
  rebateEscrow: `0x${string}`;
  usdc: `0x${string}`;
}

export function loadArcDeployment(env: Record<string, string | undefined>): PfandDeployment {
  const req = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing env ${k} (run the Arc deploy script and populate .env)`);
    return v as `0x${string}`;
  };
  return {
    identityRegistry: req("ARC_IDENTITY_REGISTRY"),
    reputationRegistry: req("ARC_REPUTATION_REGISTRY"),
    validationRegistry: req("ARC_VALIDATION_REGISTRY"),
    rebateEscrow: req("ARC_REBATE_ESCROW"),
    usdc: (env.ARC_USDC ?? ARC.usdc) as `0x${string}`,
  };
}
