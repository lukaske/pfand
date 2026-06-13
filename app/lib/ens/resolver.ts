/**
 * ENS CCIP-Read core (EIP-3668 + ENSIP-10), ported from the standalone gateway.
 *
 * The OffchainResolver on Sepolia reverts every resolve() with OffchainLookup
 * pointing at /api/ens. A CCIP-aware client (viem/ethers) calls us; we decode the
 * resolve(name,data) call, resolve the agent records, ABI-encode + sign the result
 * with the gateway signer key, and return abi.encode(result, expires, sig).
 *
 * The signature scheme matches contracts/src/ens/SignatureVerifier.sol exactly:
 *   keccak256(abi.encodePacked(0x1900, target, expires, keccak256(request), keccak256(result)))
 */

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  getAddress,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAgentRecords } from "./records";

const TTL = Number(process.env.GATEWAY_TTL_SECONDS ?? 300);

const resolverServiceAbi = [
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

const recordAbi = [
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "coinType", type: "uint256" }], outputs: [{ name: "", type: "bytes" }] },
  { type: "function", name: "text", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }], outputs: [{ name: "", type: "string" }] },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function decodeDnsName(dnsName: Hex): string {
  const bytes = hexToBytes(dnsName);
  const labels: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i]!;
    if (len === 0) break;
    labels.push(new TextDecoder().decode(bytes.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return labels.join(".");
}

export function labelFromDnsName(dnsName: Hex): string {
  return decodeDnsName(dnsName).split(".")[0] ?? "";
}

export async function resolveRecord(label: string, innerData: Hex): Promise<Hex> {
  const decoded = decodeFunctionData({ abi: recordAbi, data: innerData });
  const records = await resolveAgentRecords(label);

  if (decoded.functionName === "addr") {
    if (decoded.args.length === 1) {
      const addr = records?.addr ?? ZERO_ADDRESS;
      return encodeAbiParameters(parseAbiParameters("address"), [getAddress(addr)]);
    }
    const coinType = decoded.args[1] as bigint;
    if (coinType === 60n && records?.addr) {
      return encodeAbiParameters(parseAbiParameters("bytes"), [records.addr]);
    }
    return encodeAbiParameters(parseAbiParameters("bytes"), ["0x"]);
  }

  if (decoded.functionName === "text") {
    const key = decoded.args[1] as string;
    const value = records?.text[key] ?? "";
    return encodeAbiParameters(parseAbiParameters("string"), [value]);
  }

  return encodeAbiParameters(parseAbiParameters("bytes"), ["0x"]);
}

function loadSignerKey(): Hex {
  const k = process.env.ENS_GATEWAY_SIGNER_KEY;
  if (!k) throw new Error("Missing ENS_GATEWAY_SIGNER_KEY");
  const key = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (key.length !== 66) throw new Error("ENS_GATEWAY_SIGNER_KEY must be a 32-byte hex private key");
  return key;
}

export function signerAddress(): Address {
  return privateKeyToAccount(loadSignerKey()).address;
}

/** Build the signed CCIP response for a resolver `callData` (IResolverService.resolve). */
export async function handleResolve(sender: Address, callData: Hex): Promise<Hex> {
  const { args } = decodeFunctionData({ abi: resolverServiceAbi, data: callData });
  const dnsName = args[0] as Hex;
  const innerData = args[1] as Hex;

  const label = labelFromDnsName(dnsName);
  const result = await resolveRecord(label, innerData);
  const expires = BigInt(Math.floor(Date.now() / 1000) + TTL);

  const messageHash = keccak256(
    encodePacked(
      ["bytes2", "address", "uint64", "bytes32", "bytes32"],
      ["0x1900", getAddress(sender), expires, keccak256(callData), keccak256(result)],
    ),
  );

  const account = privateKeyToAccount(loadSignerKey());
  const sig = await account.sign({ hash: messageHash });

  return encodeAbiParameters(parseAbiParameters("bytes, uint64, bytes"), [result, expires, sig]);
}
