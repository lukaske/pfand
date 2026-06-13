/**
 * LOCAL end-to-end proof of the Pfand ENS CCIP-Read round-trip — NO Sepolia funds needed.
 *
 * What this proves, fully on a throwaway local chain:
 *   1. We deploy the *real* compiled OffchainResolver (contracts/out/...) to a local
 *      anvil chain, registering ENS_SIGNER_ADDRESS as the authorized gateway signer
 *      and a placeholder gateway URL.
 *   2. We start the *real* gateway HTTP server in-process (gateway/src/server.ts).
 *   3. For each demo subname we run the exact EIP-3668 / ENSIP-10 dance a CCIP-Read
 *      client performs:
 *         a. call resolver.resolve(dnsName, innerData)  -> reverts OffchainLookup
 *         b. decode OffchainLookup(sender, urls, callData, callbackFn, extraData)
 *         c. POST { sender, data: callData } to the gateway URL
 *         d. take the gateway's signed { data } and call
 *            resolver.resolveWithProof(data, extraData)  ON-CHAIN
 *            -> the contract ecrecovers the signature and checks `signers[...]`
 *         e. ABI-decode the verified result and print it.
 *
 * Because step (d) runs the signature check inside the deployed contract, a successful
 * decode is cryptographic proof the gateway signed the right bytes with the right key
 * for the right resolver — i.e. the same path UniversalResolver.resolveWithProof takes
 * on Sepolia, minus the funds.
 *
 * Run:  npm run e2e         (from gateway/)
 *
 * Requires `anvil` on PATH (part of Foundry). If anvil is missing the script exits
 * with a clear message.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Server } from "node:http";
import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeErrorResult,
  decodeFunctionResult,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  bytesToHex,
  getAddress,
  type Hex,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createGateway } from "./server.js";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = resolve(
  __dirname,
  "../../contracts/out/OffchainResolver.sol/OffchainResolver.json",
);

const ANVIL_PORT = Number(process.env.E2E_ANVIL_PORT ?? 8545);
const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 8788);
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}/{sender}/{data}.json`;

// Canonical anvil/Foundry dev account #0 (derived from the default
// "test test ... junk" mnemonic; address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266).
// Used only to pay gas for deploying the resolver on the throwaway local chain.
const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

// ENSIP-10 resolver ABIs we exercise.
const resolverAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function resolveWithProof(bytes response, bytes extraData) view returns (bytes)",
  "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
]);

const recordAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

// --- helpers ---

/** DNS wire-format encoder (ENSIP-10): length-prefixed labels + null terminator. */
function dnsEncode(name: string): Hex {
  const parts = name.split(".");
  const out: number[] = [];
  for (const label of parts) {
    const bytes = new TextEncoder().encode(label);
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  return bytesToHex(Uint8Array.from(out));
}

function hexToByteArray(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRpc(client: PublicClient, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`anvil did not become reachable at ${ANVIL_RPC}`);
}

/** POST { sender, data } to the running gateway and return the signed `data` field. */
async function callGateway(sender: Address, callData: Hex): Promise<Hex> {
  const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sender, data: callData }),
  });
  const body = (await res.json()) as { data?: Hex; message?: string };
  if (!res.ok || !body.data) {
    throw new Error(`gateway error ${res.status}: ${body.message ?? "no data"}`);
  }
  return body.data;
}

/**
 * Run one CCIP-Read resolution for `innerData` against the deployed resolver,
 * returning the verified (signature-checked) ABI-encoded record bytes.
 */
async function ccipResolve(
  client: PublicClient,
  resolverAddr: Address,
  dnsName: Hex,
  innerData: Hex,
): Promise<Hex> {
  const outer = encodeFunctionData({
    abi: resolverAbi,
    functionName: "resolve",
    args: [dnsName, innerData],
  });

  // Step a: call resolve() and capture the OffchainLookup revert.
  // We issue a RAW eth_call through the transport (not client.call), because
  // client.call transparently *follows* OffchainLookup via viem's built-in
  // CCIP-Read — and here we want the bare revert so we can drive each hop and
  // prove the on-chain resolveWithProof signature check explicitly.
  let revertData: Hex | undefined;
  try {
    const ret = await client.request({
      method: "eth_call",
      params: [{ to: resolverAddr, data: outer }, "latest"],
    });
    throw new Error(
      `resolve() did not revert with OffchainLookup (returned ${ret ?? "(no data)"})`,
    );
  } catch (err) {
    revertData = extractRevertData(err);
    if (!revertData) throw err;
  }

  // Step b: decode OffchainLookup.
  const decoded = decodeErrorResult({ abi: resolverAbi, data: revertData });
  if (decoded.errorName !== "OffchainLookup") {
    throw new Error(`expected OffchainLookup, got ${decoded.errorName}`);
  }
  const [sender, urls, callData, , extraData] = decoded.args as [
    Address,
    readonly string[],
    Hex,
    Hex,
    Hex,
  ];
  if (getAddress(sender) !== getAddress(resolverAddr)) {
    throw new Error("OffchainLookup sender mismatch");
  }
  if (!urls.some((u) => u.includes(`:${GATEWAY_PORT}`))) {
    throw new Error(`OffchainLookup urls did not point at our gateway: ${urls.join(", ")}`);
  }

  // Step c: POST to the gateway -> signed response.
  const signed = await callGateway(sender, callData);

  // Step d: verify on-chain via resolveWithProof (ecrecover + signers[] check happen here).
  const proofCall = encodeFunctionData({
    abi: resolverAbi,
    functionName: "resolveWithProof",
    args: [signed, extraData],
  });
  const { data: verified } = await client.call({ to: resolverAddr, data: proofCall });
  if (!verified) throw new Error("resolveWithProof returned empty");

  // resolveWithProof returns `bytes` (the inner record value), ABI-decode the outer bytes wrapper.
  return decodeFunctionResult({
    abi: resolverAbi,
    functionName: "resolveWithProof",
    data: verified,
  }) as Hex;
}

/** Pull the raw revert data out of a viem CallExecutionError, however it's nested. */
function extractRevertData(err: unknown): Hex | undefined {
  let e: any = err;
  for (let i = 0; i < 8 && e; i++) {
    if (typeof e.data === "string" && e.data.startsWith("0x")) return e.data as Hex;
    if (e.data?.data && typeof e.data.data === "string") return e.data.data as Hex;
    if (typeof e.raw === "string" && e.raw.startsWith("0x")) return e.raw as Hex;
    e = e.cause;
  }
  return undefined;
}

// --- main ---

async function main() {
  const signerKey = process.env.ENS_GATEWAY_SIGNER_KEY;
  if (!signerKey) throw new Error("Missing ENS_GATEWAY_SIGNER_KEY in .env");
  const signerKeyHex = (signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`) as Hex;
  const expectedSigner = privateKeyToAccount(signerKeyHex).address;

  console.log("=== Pfand ENS local end-to-end proof ===\n");
  console.log(`anvil RPC        : ${ANVIL_RPC}`);
  console.log(`gateway URL      : ${GATEWAY_URL}`);
  console.log(`gateway signer   : ${expectedSigner}`);
  console.log(`(ENS_SIGNER_ADDRESS env: ${process.env.ENS_SIGNER_ADDRESS ?? "(unset)"})\n`);

  // 1. boot anvil
  console.log("[1/5] starting anvil...");
  let anvil: ChildProcess | undefined;
  let gateway: Server | undefined;
  try {
    anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--silent"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    anvil.on("error", (e) => {
      console.error("Failed to spawn anvil (is Foundry installed and on PATH?):", e.message);
    });

    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(ANVIL_RPC),
    }) as PublicClient;
    await waitForRpc(publicClient);
    console.log("      anvil up.");

    // 2. deploy the real compiled OffchainResolver
    console.log("[2/5] deploying OffchainResolver (real compiled artifact)...");
    const artifact = JSON.parse(await readFile(ARTIFACT, "utf8")) as {
      abi: unknown[];
      bytecode: { object: Hex };
    };
    const deployer = privateKeyToAccount(ANVIL_KEY_0);
    const wallet = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(ANVIL_RPC),
    });

    const deployHash = await wallet.deployContract({
      abi: artifact.abi as never,
      bytecode: artifact.bytecode.object,
      args: [GATEWAY_URL, [expectedSigner]],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const resolverAddr = receipt.contractAddress;
    if (!resolverAddr) throw new Error("deployment produced no contract address");
    console.log(`      OffchainResolver @ ${resolverAddr}`);

    // sanity: read url + signers from the chain
    const urlOnChain = await publicClient.readContract({
      address: resolverAddr,
      abi: parseAbi(["function url() view returns (string)"]),
      functionName: "url",
    });
    const signerAuthorized = await publicClient.readContract({
      address: resolverAddr,
      abi: parseAbi(["function signers(address) view returns (bool)"]),
      functionName: "signers",
      args: [expectedSigner],
    });
    console.log(`      on-chain url() = ${urlOnChain}`);
    console.log(`      on-chain signers[${expectedSigner}] = ${signerAuthorized}\n`);
    if (!signerAuthorized) throw new Error("signer not authorized on deployed resolver");

    // 3. start the real gateway in-process
    console.log("[3/5] starting gateway server in-process...");
    gateway = createGateway(signerKeyHex);
    await new Promise<void>((r) => gateway!.listen(GATEWAY_PORT, () => r()));
    console.log(`      gateway listening on :${GATEWAY_PORT}\n`);

    // 4. resolve demo names through the full signed round-trip
    const parent = process.env.ENS_PARENT_NAME || "agent8004.eth";
    const labels = ["story", "gekko", "openodds", "dackie", "ethy"];
    const node = "0x" + "0".repeat(64); // node value is irrelevant: gateway keys off the DNS label

    console.log("[4/5] resolving demo names via CCIP-Read (resolve -> gateway -> resolveWithProof):\n");

    let proven = 0;
    for (const label of labels) {
      const name = `${label}.${parent}`;
      const dnsName = dnsEncode(name);
      console.log(`  ${name}`);

      // addr(node)
      const addrCall = encodeFunctionData({
        abi: recordAbi,
        functionName: "addr",
        args: [node as Hex],
      });
      const addrResult = await ccipResolve(publicClient, resolverAddr, dnsName, addrCall);
      const addrVal = decodeFunctionResult({
        abi: recordAbi,
        functionName: "addr",
        data: addrResult,
      });
      console.log(`    addr                              -> ${addrVal}`);

      // text(node, key) for each ENSIP-25 / ENSIP-26 key
      const keys = buildKeysFor(label);
      for (const key of keys) {
        const textCall = encodeFunctionData({
          abi: recordAbi,
          functionName: "text",
          args: [node as Hex, key],
        });
        const textResult = await ccipResolve(publicClient, resolverAddr, dnsName, textCall);
        const textVal = decodeFunctionResult({
          abi: recordAbi,
          functionName: "text",
          data: textResult,
        });
        const shown = textVal && textVal.length > 76 ? textVal.slice(0, 73) + "..." : textVal;
        const keyShown = key.length > 56 ? key.slice(0, 28) + "…" + key.slice(-24) : key;
        console.log(`    text[${keyShown}]`.padEnd(40) + `-> ${shown || "(empty)"}`);
      }
      console.log("");
      proven++;
    }

    // Negative control: tamper with the gateway's signed response and confirm the
    // on-chain resolveWithProof REJECTS it (proving the values above weren't trusted blindly).
    console.log("[*] negative control: forging the gateway signature must be rejected on-chain...");
    {
      const dnsName = dnsEncode(`story.${parent}`);
      const textCall = encodeFunctionData({
        abi: recordAbi,
        functionName: "text",
        args: [node as Hex, "agent-context"],
      });
      const outer = encodeFunctionData({
        abi: resolverAbi,
        functionName: "resolve",
        args: [dnsName, textCall],
      });
      // get the OffchainLookup extraData + the gateway's genuine signed response
      let revertData: Hex | undefined;
      try {
        await publicClient.request({
          method: "eth_call",
          params: [{ to: resolverAddr, data: outer }, "latest"],
        });
      } catch (err) {
        revertData = extractRevertData(err);
      }
      const dec = decodeErrorResult({ abi: resolverAbi, data: revertData! });
      const [sender, , callData, , extraData] = dec.args as [Address, string[], Hex, Hex, Hex];
      const signed = await callGateway(sender, callData);
      // Decode (result, expires, sig), flip a byte INSIDE the 65-byte signature's `s`
      // component (not the zero-padding), and re-encode — so ecrecover yields a wrong signer.
      const [resBytes, expires, sig] = decodeAbiParameters(
        parseAbiParameters("bytes, uint64, bytes"),
        signed,
      ) as [Hex, bigint, Hex];
      const sigBytes = hexToByteArray(sig);
      sigBytes[10] = (sigBytes[10] ?? 0) ^ 0xff; // flip a byte inside `r` -> wrong recovered signer
      const forged = encodeAbiParameters(parseAbiParameters("bytes, uint64, bytes"), [
        resBytes,
        expires,
        bytesToHex(sigBytes),
      ]);
      const proofCall = encodeFunctionData({
        abi: resolverAbi,
        functionName: "resolveWithProof",
        args: [forged, extraData],
      });
      let rejected = false;
      try {
        await publicClient.request({
          method: "eth_call",
          params: [{ to: resolverAddr, data: proofCall }, "latest"],
        });
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("FORGED signature was NOT rejected — proof invalid!");
      console.log("    forged response correctly REVERTED by resolveWithProof.\n");
    }

    console.log(`[5/5] PROOF COMPLETE: ${proven}/${labels.length} names resolved through a`);
    console.log(`      signature-verified CCIP-Read round-trip (resolveWithProof reverts on a`);
    console.log(`      bad/forged signature; every value above passed on-chain ecrecover).`);
    console.log(`\n=== OK ===`);
  } finally {
    if (gateway) await new Promise<void>((r) => gateway!.close(() => r()));
    if (anvil && !anvil.killed) anvil.kill("SIGKILL");
  }
}

/** ENSIP-25 registration key + ENSIP-26 keys we expect for a given demo label. */
function buildKeysFor(label: string): string[] {
  // The mainnet ERC-8004 IdentityRegistry ERC-7930 address + each agent's real agentId.
  // (Matches records.ts: registry 0x8004A169…, agentIds below.)
  const reg = "0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432";
  const agentIds: Record<string, number> = {
    story: 14645,
    gekko: 13445,
    openodds: 22771,
    dackie: 9382,
    ethy: 9380,
  };
  const id = agentIds[label];
  const keys = [
    "agent-context",
    "agent-endpoint[mcp]",
    "agent-endpoint[a2a]",
    "agent-endpoint[web]",
  ];
  if (id !== undefined) keys.unshift(`agent-registration[${reg}][${id}]`);
  return keys;
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
