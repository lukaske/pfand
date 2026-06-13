/**
 * End-to-end LIVE verification of `<agent>.agent8004.eth` on Sepolia.
 *
 * Proves the full chain works against the *deployed* OffchainResolver and the *live*
 * Vercel gateway — no local server, no hardcoded values:
 *
 *   viem.call(resolver, resolve(dnsName, innerCall))
 *     -> OffchainResolver reverts with OffchainLookup (EIP-3668)
 *     -> viem's ccipRead hops to the live gateway (https://app-theta-azure-54.vercel.app/...)
 *     -> gateway returns a signed response
 *     -> viem re-enters resolveWithProof on-chain; the resolver verifies the signer
 *     -> we decode the verified record value.
 *
 * We call the OffchainResolver directly (ENSIP-10 `resolve(bytes,bytes)`) rather than
 * going through a UniversalResolver: the name was registered via the ENSv1 path
 * (Registry.resolver(agent8004.eth) == OffchainResolver), and the current Sepolia
 * UniversalResolver ABIs are in flux (viem 2.52 calls `resolveWithGateways`, which the
 * v1 UR on Sepolia doesn't expose). Calling the resolver directly exercises the exact
 * same CCIP-Read + on-chain signature-verification path and is version-independent.
 *
 * Env (.env):
 *   SEPOLIA_RPC_URL   an RPC that lets viem do the offchain hop (it does the HTTP itself).
 *
 * Run: npm run verify
 */

import { config } from "dotenv";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  toHex,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { namehash, normalize, packetToBytes } from "viem/ens";
import { sepolia } from "viem/chains";
import { erc7930Mainnet, agentRegistrationKey } from "./records.js";

config();

// The deployed Sepolia OffchainResolver (wildcard, ENSIP-10).
const OFFCHAIN_RESOLVER = getAddress(
  "0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147",
);
// Mainnet ERC-8004 IdentityRegistry (for the ENSIP-25 registration key).
const MAINNET_IDENTITY_REGISTRY = getAddress(
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
);

// ENSIP-10 resolve(bytes name, bytes data) on the OffchainResolver.
const resolveAbi = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

// Inner record functions.
const addrAbi = [
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const textAbi = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

type Client = ReturnType<typeof createPublicClient>;

/** Resolve addr(node) for a name via the deployed resolver + live gateway (CCIP-Read). */
async function resolveAddr(
  client: Client,
  name: string,
): Promise<Address | null> {
  const node = namehash(name);
  const dnsName = toHex(packetToBytes(name));
  const inner = encodeFunctionData({
    abi: addrAbi,
    functionName: "addr",
    args: [node],
  });
  const outer = encodeFunctionData({
    abi: resolveAbi,
    functionName: "resolve",
    args: [dnsName, inner],
  });
  const { data } = await client.call({ to: OFFCHAIN_RESOLVER, data: outer });
  if (!data) return null;
  const innerResult = decodeFunctionResult({
    abi: resolveAbi,
    functionName: "resolve",
    data,
  }) as Hex;
  const addr = decodeFunctionResult({
    abi: addrAbi,
    functionName: "addr",
    data: innerResult,
  }) as Address;
  return addr === "0x0000000000000000000000000000000000000000" ? null : addr;
}

/** Resolve text(node, key) for a name via the deployed resolver + live gateway. */
async function resolveText(
  client: Client,
  name: string,
  key: string,
): Promise<string> {
  const node = namehash(name);
  const dnsName = toHex(packetToBytes(name));
  const inner = encodeFunctionData({
    abi: textAbi,
    functionName: "text",
    args: [node, key],
  });
  const outer = encodeFunctionData({
    abi: resolveAbi,
    functionName: "resolve",
    args: [dnsName, inner],
  });
  const { data } = await client.call({ to: OFFCHAIN_RESOLVER, data: outer });
  if (!data) return "";
  const innerResult = decodeFunctionResult({
    abi: resolveAbi,
    functionName: "resolve",
    data,
  }) as Hex;
  return decodeFunctionResult({
    abi: textAbi,
    functionName: "text",
    data: innerResult,
  }) as string;
}

async function verifyOne(client: Client, name: string, agentId: number) {
  const normalized = normalize(name);
  console.log(`\n=== ${normalized}  (namehash ${namehash(normalized)}) ===`);

  const addr = await resolveAddr(client, normalized);
  console.log(`  addr                         -> ${addr ?? "(none)"}`);

  const context = await resolveText(client, normalized, "agent-context");
  console.log(`  text[agent-context]          -> ${context || "(none)"}`);

  const mcp = await resolveText(client, normalized, "agent-endpoint[mcp]");
  console.log(`  text[agent-endpoint[mcp]]    -> ${mcp || "(none)"}`);

  // ENSIP-25 verifiable registration key for the mainnet ERC-8004 (registry, agentId).
  const regKey = agentRegistrationKey(
    erc7930Mainnet(MAINNET_IDENTITY_REGISTRY),
    agentId,
  );
  const reg = await resolveText(client, normalized, regKey);
  console.log(`  text[agent-registration[...]] -> ${reg ? `"${reg}" (verified link to mainnet #${agentId})` : "(none)"}`);
}

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL");

  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
    // ccipRead is enabled by default; left explicit for clarity.
    ccipRead: undefined,
  });

  console.log(
    `Resolving subnames of agent8004.eth via the LIVE deployed resolver ${OFFCHAIN_RESOLVER}`,
  );
  console.log(
    `(each call: viem -> Sepolia OffchainResolver -> OffchainLookup -> live Vercel gateway -> signed -> on-chain verify)`,
  );

  await verifyOne(client, "story.agent8004.eth", 14645);
  await verifyOne(client, "gekko.agent8004.eth", 13445);

  console.log("\nDone — values above were served by the live gateway and signature-verified on-chain.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
