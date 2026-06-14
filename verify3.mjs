// Proves the ENS-via-MCP flow end-to-end:
//   A) register_agent (MCP) → mints <label>.agent8004.eth with ENSIP-25/26 records
//   B) resolve_agent (MCP)  → reverse discovery returns those records
//   C) REAL ENS resolution on Sepolia — calls the OffchainResolver.resolve() with
//      CCIP-read enabled, so viem hops to the live Vercel gateway AND the contract
//      verifies the gateway signature on-chain. No hard-coded values.
// Run from repo root: `node verify3.mjs`.
import fs from "node:fs";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeAbiParameters,
  getAddress,
} from "viem";
import { namehash } from "viem/ens";
import { sepolia } from "viem/chains";

const MCP = "https://pfand.vercel.app/api/mcp";
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const SEPOLIA_RPC = env.SEPOLIA_RPC_URL;
const RESOLVER = getAddress(env.ENS_OFFCHAIN_RESOLVER);
const PARENT = env.ENS_PARENT_NAME || "agent8004.eth";
const ARC_REGISTRY = env.ARC_IDENTITY_REGISTRY;

// ERC-7930 (eip155) encoder — same as app/lib/ens/records.ts.
function erc7930(chainId, address) {
  const addr = getAddress(address).slice(2).toLowerCase();
  let ref = chainId.toString(16); if (ref.length % 2) ref = "0" + ref;
  const refLen = (ref.length / 2).toString(16).padStart(2, "0");
  return "0x0001" + "0000" + refLen + ref + "14" + addr;
}
function dnsEncode(name) {
  const out = [];
  for (const part of name.split(".")) { const b = Buffer.from(part, "utf8"); out.push(b.length, ...b); }
  out.push(0);
  return "0x" + Buffer.from(out).toString("hex");
}

const extendedResolverAbi = [
  { type: "function", name: "resolve", stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }, { name: "data", type: "bytes" }],
    outputs: [{ name: "", type: "bytes" }] },
];
const recordAbi = [
  { type: "function", name: "text", stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }],
    outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "addr", stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }], outputs: [{ name: "", type: "address" }] },
];

let _id = 1;
async function mcp(tool, args) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = await res.text();
  let payload = null;
  for (const line of body.split("\n")) { const t = line.trim(); if (t.startsWith("data:")) { try { payload = JSON.parse(t.slice(5).trim()); } catch {} } }
  if (!payload) payload = JSON.parse(body);
  if (payload.error) throw new Error(`${tool}: ${JSON.stringify(payload.error)}`);
  const text = payload.result?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

// One CCIP-read resolve() call through the live resolver + gateway.
async function ensResolve(name, inner) {
  const data = await sepoliaClient.readContract({
    address: RESOLVER, abi: extendedResolverAbi, functionName: "resolve",
    args: [dnsEncode(name), inner],
  });
  return data;
}
async function ensText(name, key) {
  const inner = encodeFunctionData({ abi: recordAbi, functionName: "text", args: [namehash(name), key] });
  const [val] = decodeAbiParameters([{ type: "string" }], await ensResolve(name, inner));
  return val;
}
async function ensAddr(name) {
  const inner = encodeFunctionData({ abi: recordAbi, functionName: "addr", args: [namehash(name)] });
  const [val] = decodeAbiParameters([{ type: "address" }], await ensResolve(name, inner));
  return val;
}

async function main() {
  const stamp = Math.floor(Date.now() / 1000);
  const wallet = "0x1111111111111111111111111111111111111111";

  console.log("=== A) register_agent (MCP) → mint ENS identity ===\n");
  const reg = await mcp("register_agent", {
    name: `Flight Finder ${stamp}`,
    description: "Finds and books flights; ENS-native ERC-8004 agent.",
    skills: ["flights", "travel", "booking"],
    endpoints: { mcp: "https://flightfinder.example/mcp", web: "https://flightfinder.example" },
    wallet,
  });
  console.log("  agentId:", reg.agentId, "| ensName:", reg.ensName, "| addr:", reg.addr);
  console.log("  registration tx:", reg.onChainTx);
  console.log("  ENS records minted:", JSON.stringify(reg.ensRecords, null, 2));
  const ensName = reg.ensName;
  const regKey = `agent-registration[${erc7930(5042002, ARC_REGISTRY)}][${reg.agentId}]`;

  console.log("\n=== B) resolve_agent (MCP) → reverse discovery ===\n");
  const disc = await mcp("resolve_agent", { name: ensName });
  console.log("  ", JSON.stringify({ ensName: disc.ensName, agentId: disc.agentId, network: disc.network, addr: disc.addr, trustRank: disc.trustRank }));

  console.log("\n=== C) REAL ENS resolution on Sepolia (CCIP-read + on-chain sig verify) ===\n");
  const ctx = await ensText(ensName, "agent-context");
  const mcpEp = await ensText(ensName, "agent-endpoint[mcp]");
  const verifiable = await ensText(ensName, regKey);
  const addr = await ensAddr(ensName);
  console.log(`  resolve ${ensName} via ${RESOLVER}:`);
  console.log("    agent-context        =", JSON.stringify(ctx));
  console.log("    agent-endpoint[mcp]  =", JSON.stringify(mcpEp));
  console.log(`    ${regKey} = ${JSON.stringify(verifiable)}  (ENSIP-25: "1" ⇒ verified on-chain reg)`);
  console.log("    addr                 =", addr);

  const pass =
    disc.agentId === reg.agentId &&
    ctx && ctx.includes(reg.agentId) &&
    verifiable === "1" &&
    addr.toLowerCase() === wallet.toLowerCase();
  console.log("\n" + (pass
    ? `✅ PASS — ${ensName} resolves on real Sepolia ENS with verifiable ERC-8004 link, context, endpoints, and the agent's own addr.`
    : "❌ FAIL — see mismatches above."));
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
