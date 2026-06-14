// Verifies the per-index claimRebate upgrade against the LIVE redeployed escrow.
//   A) live MCP loop (hire → review) still closes through the new contract
//   B) direct on-chain proof: two jobs, ONE review releases only ONE — the second
//      claim with the same feedback index reverts "feedback already used".
// Run from repo root: `node verify2.mjs`.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rebateEscrowAbi, reputationRegistryAbi, erc20Abi } from "./packages/shared/src/abis.ts";

// --- config / env ---
const MCP = "https://pfand.vercel.app/api/mcp";
const RPC = "https://rpc.testnet.arc.network";
const ESCROW = "0x267540b15b3877b042fc29dd4944306e6d24AE5B"; // NEW escrow
const REP = "0x3A158775BB1D1F5f823712327fBBD3d977FA9A9d";
const USDC = "0x3600000000000000000000000000000000000000";
const AGENT_ID = 20n; // travel-concierge
const SERVICE_WALLET = "0x4AEDE02c0BB911424420C50A03e26092179252aC";
const TX = (h) => `https://testnet.arcscan.app/tx/${h}`;

const KEY = (fs.readFileSync(".env", "utf8").match(/^BROKER_X402_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("BROKER_X402_KEY not found in .env");

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain: arcChain, transport: http(RPC) });
const account = privateKeyToAccount(KEY.startsWith("0x") ? KEY : "0x" + KEY);
const wallet = createWalletClient({ account, chain: arcChain, transport: http(RPC) });

// --- MCP helper ---
let _id = 1;
async function mcp(tool, args) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = await res.text();
  let payload = null;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("data:")) { try { payload = JSON.parse(t.slice(5).trim()); } catch {} }
  }
  if (!payload) payload = JSON.parse(body);
  if (payload.error) throw new Error(`${tool}: ${JSON.stringify(payload.error)}`);
  const text = payload.result?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// --- on-chain helpers ---
async function send(call, label) {
  const hash = await wallet.writeContract(call);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${label} reverted (${hash})`);
  return { hash, rcpt };
}
function eventArg(rcpt, abi, name, key) {
  for (const lg of rcpt.logs) {
    try {
      const d = decodeEventLog({ abi, data: lg.data, topics: lg.topics });
      if (d.eventName === name) return d.args[key];
    } catch {}
  }
  return undefined;
}
async function openJob() {
  const { rcpt } = await send({
    address: ESCROW, abi: rebateEscrowAbi, functionName: "openJob",
    args: [AGENT_ID, SERVICE_WALLET, 500000n, 86400n],
  }, "openJob");
  return eventArg(rcpt, rebateEscrowAbi, "JobOpened", "jobId");
}
async function giveFeedback(tag) {
  const uri = `data:,concurrency proof ${tag}`;
  const { rcpt, hash } = await send({
    address: REP, abi: reputationRegistryAbi, functionName: "giveFeedback",
    args: [AGENT_ID, 1n, 0, "concurrency", "good", "", uri, keccak256(toBytes(uri))],
  }, "giveFeedback");
  return { idx: eventArg(rcpt, reputationRegistryAbi, "NewFeedback", "feedbackIndex"), hash };
}
async function tryClaim(jobId, idx) {
  try {
    const { hash } = await send({
      address: ESCROW, abi: rebateEscrowAbi, functionName: "claimRebate", args: [jobId, idx],
    }, "claimRebate");
    return { ok: true, hash };
  } catch (e) {
    const m = e.shortMessage || e.message || String(e);
    return { ok: false, reason: m };
  }
}

async function main() {
  console.log("=== A) Live MCP loop through the new escrow ===\n");
  const hire = await mcp("hire_agent", { agent: "travel-concierge", message: "Cheapest NYC→Rome next Monday?" });
  console.log("hire  → jobId", hire.jobId, "|", hire.escrow);
  const review = await mcp("review_agent", { agent: "travel-concierge", state: "good", jobId: hire.jobId ?? null });
  console.log("review→ feedback tx", review.onChainTx ? TX(review.onChainTx) : "(none)");
  console.log("        pfand:", review.pfand, "| newTrustRank:", review.newTrustRank);

  console.log("\n=== B) Direct on-chain concurrency proof (new escrow) ===\n");
  // Approve enough USDC for two 0.05 pfand bonds.
  await send({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, 200000n] }, "approve");

  const jobA = await openJob();
  const jobB = await openJob();
  console.log(`opened two jobs for agent ${AGENT_ID}: A=#${jobA}  B=#${jobB} (one review each is now required)`);

  const f1 = await giveFeedback("review-1");
  console.log(`\nposted ONE review → feedbackIndex ${f1.idx}`);
  console.log("  feedback tx:", TX(f1.hash));

  const claimA = await tryClaim(jobA, f1.idx);
  console.log(`\nclaim A with index ${f1.idx}:`, claimA.ok ? `✅ released  ${TX(claimA.hash)}` : `❌ ${claimA.reason}`);

  const claimB1 = await tryClaim(jobB, f1.idx);
  console.log(`claim B with SAME index ${f1.idx}:`, claimB1.ok ? `⚠️ UNEXPECTEDLY released ${TX(claimB1.hash)}` : `✅ correctly blocked → "${claimB1.reason}"`);

  const f2 = await giveFeedback("review-2");
  console.log(`\nposted a SECOND distinct review → feedbackIndex ${f2.idx}`);
  console.log("  feedback tx:", TX(f2.hash));
  const claimB2 = await tryClaim(jobB, f2.idx);
  console.log(`claim B with NEW index ${f2.idx}:`, claimB2.ok ? `✅ released  ${TX(claimB2.hash)}` : `❌ ${claimB2.reason}`);

  const pass = claimA.ok && !claimB1.ok && claimB2.ok && /already used/i.test(claimB1.reason || "");
  console.log("\n" + (pass ? "✅ PASS — one review releases exactly one job; the second job needs its own review." :
                              "❌ FAIL — concurrency guarantee not observed."));
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
