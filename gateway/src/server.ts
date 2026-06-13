/**
 * Pfand ENS CCIP-Read gateway (EIP-3668 + ENSIP-10).
 *
 * The OffchainResolver on Sepolia reverts every resolve() with OffchainLookup pointing
 * at this gateway. A CCIP-aware client (viem, ethers) then calls us with:
 *
 *   GET  /{sender}/{data}.json
 *   POST /            body: { sender, data }
 *
 * where `data` is the ABI-encoded `IResolverService.resolve(bytes name, bytes data)` call
 * (the resolver's `callData`). We:
 *   1. decode it -> (dnsName, innerData)
 *   2. extract the subname label from the DNS-encoded name
 *   3. decode innerData -> addr(node) | text(node, key)
 *   4. resolve the agent records (records.ts; seed map now, index later)
 *   5. ABI-encode the result
 *   6. sign keccak(0x1900 ++ resolver ++ expires ++ keccak(callData) ++ keccak(result))
 *   7. respond { data: abi.encode(result, expires, sig) }
 *
 * The signature scheme matches contracts/src/ens/SignatureVerifier.sol exactly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toHex,
  getAddress,
  isHex,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAgentRecords } from "./records.js";

// --- config ---

const PORT = Number(process.env.PORT ?? 8080);
const TTL = Number(process.env.GATEWAY_TTL_SECONDS ?? 300);

function loadSignerKey(): Hex {
  const k = process.env.ENS_GATEWAY_SIGNER_KEY;
  if (!k) throw new Error("Missing ENS_GATEWAY_SIGNER_KEY");
  const key = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (key.length !== 66) throw new Error("ENS_GATEWAY_SIGNER_KEY must be a 32-byte hex private key");
  return key;
}

// --- ABIs ---

// IResolverService.resolve(bytes name, bytes data) — the outer call the resolver wraps.
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

// The inner record functions encoded inside `data`.
const recordAbi = [
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// --- DNS name decoding (ENSIP-10 wire format) ---

/** Decode a DNS wire-format name into dot-separated labels (e.g. "alice.broker8004.eth"). */
export function decodeDnsName(dnsName: Hex): string {
  const bytes = hexToBytes(dnsName);
  const labels: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i]!;
    if (len === 0) break;
    const label = bytes.slice(i + 1, i + 1 + len);
    labels.push(new TextDecoder().decode(label));
    i += 1 + len;
  }
  return labels.join(".");
}

/** The subname label = the first label (the part before the parent name). */
export function labelFromDnsName(dnsName: Hex): string {
  const full = decodeDnsName(dnsName);
  return full.split(".")[0] ?? "";
}

function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// --- core resolution ---

export interface ResolveResult {
  /** ABI-encoded return value of the inner record function. */
  result: Hex;
}

/**
 * Resolve the inner record call for a given subname label.
 * Returns the ABI-encoded result exactly as the inner function would return it.
 */
export async function resolveRecord(label: string, innerData: Hex): Promise<Hex> {
  const decoded = decodeFunctionData({ abi: recordAbi, data: innerData });
  const records = await resolveAgentRecords(label);

  if (decoded.functionName === "addr") {
    // addr(bytes32) -> address ; addr(bytes32,uint256) -> bytes
    if (decoded.args.length === 1) {
      const addr = records?.addr ?? ZERO_ADDRESS;
      return encodeAbiParameters(parseAbiParameters("address"), [getAddress(addr)]);
    }
    // coin-type form: return the 20-byte address as bytes for ETH (coinType 60), else empty.
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

  // Unknown record type: return empty bytes-shaped value.
  return encodeAbiParameters(parseAbiParameters("bytes"), ["0x"]);
}

/**
 * Build the signed CCIP response for a resolver `callData` (the IResolverService.resolve call).
 * @param sender   the resolver contract address (from the request).
 * @param callData the ABI-encoded resolve(name,data) call.
 */
export async function handleResolve(
  sender: Address,
  callData: Hex,
  signerKey: Hex,
): Promise<Hex> {
  const { args } = decodeFunctionData({ abi: resolverServiceAbi, data: callData });
  const dnsName = args[0] as Hex;
  const innerData = args[1] as Hex;

  const label = labelFromDnsName(dnsName);
  const result = await resolveRecord(label, innerData);

  const expires = BigInt(Math.floor(Date.now() / 1000) + TTL);

  // makeSignatureHash(target, expires, request, result):
  //   keccak256(abi.encodePacked(0x1900, target, expires, keccak256(request), keccak256(result)))
  const messageHash = keccak256(
    encodePacked(
      ["bytes2", "address", "uint64", "bytes32", "bytes32"],
      ["0x1900", getAddress(sender), expires, keccak256(callData), keccak256(result)],
    ),
  );

  const account = privateKeyToAccount(signerKey);
  const sig = await account.sign({ hash: messageHash });

  // response = abi.encode(bytes result, uint64 expires, bytes sig)
  return encodeAbiParameters(parseAbiParameters("bytes, uint64, bytes"), [result, expires, sig]);
}

// --- HTTP layer ---

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function createGateway(signerKey: Hex) {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        const account = privateKeyToAccount(signerKey);
        return sendJson(res, 200, { ok: true, signer: account.address });
      }

      let sender: string | undefined;
      let data: string | undefined;

      if (req.method === "POST") {
        const parsed = JSON.parse((await readBody(req)) || "{}");
        sender = parsed.sender;
        data = parsed.data;
      } else if (req.method === "GET" && req.url) {
        // /{sender}/{data}.json
        const m = req.url.match(/^\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]+)\.json$/);
        if (m) {
          sender = m[1];
          data = m[2];
        }
      }

      if (!sender || !data || !isHex(sender) || !isHex(data)) {
        return sendJson(res, 400, { message: "Bad request: expected { sender, data } hex" });
      }

      const responseData = await handleResolve(getAddress(sender), data as Hex, signerKey);
      return sendJson(res, 200, { data: responseData });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 4xx so CCIP clients surface the error rather than retrying forever.
      return sendJson(res, 400, { message });
    }
  });
}

// --- entrypoint ---

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Lazy dotenv import keeps this file importable in tests without env side effects.
  const { config } = await import("dotenv");
  config();
  const signerKey = loadSignerKey();
  const account = privateKeyToAccount(signerKey);
  createGateway(signerKey).listen(PORT, () => {
    console.log(`Pfand ENS gateway listening on :${PORT}`);
    console.log(`Signing as ${account.address} (register this as SIGNER_ADDRESS on the resolver)`);
    console.log(`Sample: GET http://localhost:${PORT}/health`);
  });
}

export { toHex };
