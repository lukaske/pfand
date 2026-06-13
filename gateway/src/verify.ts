/**
 * End-to-end verification: resolve a name through a *running* gateway + *deployed* resolver
 * using viem's built-in CCIP-Read support.
 *
 * Prerequisites:
 *   - Gateway running (npm run dev) and reachable at GATEWAY_URL.
 *   - OffchainResolver deployed on Sepolia and set as the resolver of broker8004.eth
 *     (or whatever ENS_PARENT_NAME you own), with the gateway's signer registered.
 *
 * Env (.env):
 *   SEPOLIA_RPC_URL       an RPC that supports eth_call CCIP (viem does the offchain hop).
 *   ENS_PARENT_NAME       parent you own, default "broker8004.eth".
 *   ENS_VERIFY_LABEL      subname label to resolve, default "alice".
 *
 * Run: npm run verify
 *
 * viem reads `url` off the resolver, catches the OffchainLookup revert, calls our gateway,
 * then calls resolveWithProof on-chain to verify the signature — all inside getEnsText/getEnsAddress.
 */

import { config } from "dotenv";
import { createPublicClient, http } from "viem";
import { namehash, normalize } from "viem/ens";
import { sepolia } from "viem/chains";

config();

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL");

  const parent = process.env.ENS_PARENT_NAME ?? "broker8004.eth";
  const label = process.env.ENS_VERIFY_LABEL ?? "alice";
  const name = normalize(`${label}.${parent}`);

  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
    // ccipRead is enabled by default in viem; left explicit for clarity.
    ccipRead: undefined,
  });

  console.log(`Resolving ${name} (namehash ${namehash(name)}) via Sepolia + gateway...\n`);

  const addr = await client.getEnsAddress({ name });
  console.log(`addr                       -> ${addr ?? "(none)"}`);

  const keys = [
    "agent-context",
    "agent-endpoint[mcp]",
    "agent-endpoint[a2a]",
    "agent-endpoint[web]",
  ];
  for (const key of keys) {
    const value = await client.getEnsText({ name, key });
    console.log(`text[${key}]`.padEnd(28) + `-> ${value ?? "(none)"}`);
  }

  // ENSIP-25 registration key (mainnet IdentityRegistry, agentId 42 for alice).
  const reg =
    "agent-registration[0x00010000010114" +
    "8004a169fb4a3325136eb29fa0ceb6d2e539a432][42]";
  const verified = await client.getEnsText({ name, key: reg });
  console.log(`ENSIP-25 verified link     -> ${verified ? "YES (" + verified + ")" : "no"}`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
