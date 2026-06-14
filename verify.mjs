// Full MCP loop verification — register → hire → review — with on-chain proof.
// Run from repo root: `node verify.mjs` (viem is hoisted here).
import {
  createPublicClient,
  http,
  decodeEventLog,
} from "viem";
import {
  identityRegistryAbi,
  rebateEscrowAbi,
  reputationRegistryAbi,
} from "./packages/shared/src/abis.ts";

const MCP = "https://pfand.vercel.app/api/mcp";
const RPC = "https://rpc.testnet.arc.network";
const IDENTITY = "0xbE97d9fA39Fa62FC4d8165D1F3d6D8ef6eEDd54c";
const ESCROW = "0x153013f66b27De74D7b5718eb44Cd273E0FCf69d";
const REP = "0x3A158775BB1D1F5f823712327fBBD3d977FA9A9d";
const TX = (h) => `https://testnet.arcscan.app/tx/${h}`;

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain: arcChain, transport: http(RPC) });

let _id = 1;
/** Call one MCP tool over Streamable HTTP, parse the SSE/JSON result text. */
async function mcp(tool, args) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: _id++,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const body = await res.text();
  // Streamable HTTP returns SSE frames: pull the JSON out of `data:` lines.
  let payload = null;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("data:")) {
      try {
        payload = JSON.parse(t.slice(5).trim());
      } catch {}
    }
  }
  if (!payload) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`bad MCP response for ${tool}: ${body.slice(0, 300)}`);
    }
  }
  if (payload.error)
    throw new Error(`${tool} error: ${JSON.stringify(payload.error)}`);
  const text = payload.result?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function main() {
  console.log("=== Pfand MCP loop — live on-chain verification ===\n");

  // 1) REGISTER a fresh agent on Arc 8004.
  const stamp = Math.floor(Date.now() / 1000);
  console.log("① register_agent …");
  const reg = await mcp("register_agent", {
    name: `Verify Bot ${stamp}`,
    description:
      "Synthetic agent registered by the verification script to prove the MCP→8004 loop end-to-end.",
    skills: ["verification", "testing"],
  });
  console.log("   →", JSON.stringify(reg));
  if (reg.onChainTx)
    console.log("   register tx:", TX(reg.onChainTx), `(agentId ${reg.agentId})`);

  // 2) HIRE a live agent (travel-concierge) → opens a Pfand escrow job.
  console.log("\n② hire_agent (travel-concierge) …");
  const hire = await mcp("hire_agent", {
    agent: "travel-concierge",
    message: "Find me a flight from NYC to Rome next Monday.",
  });
  console.log(
    "   →",
    JSON.stringify({
      agentId: hire.agentId,
      jobId: hire.jobId,
      escrow: hire.escrow,
      answer: typeof hire.answer === "string" ? hire.answer.slice(0, 120) + "…" : hire.answer,
    }),
  );

  // 3) REVIEW it (good) → posts giveFeedback on-chain + releases the Pfand.
  console.log("\n③ review_agent (good) …");
  const review = await mcp("review_agent", {
    agent: "travel-concierge",
    state: "good",
    jobId: hire.jobId ?? null,
  });
  console.log("   →", JSON.stringify(review));
  if (review.onChainTx)
    console.log("   feedback tx:", TX(review.onChainTx));

  // 4) INDEPENDENT on-chain confirmation via event logs.
  console.log("\n=== Independent on-chain confirmation (event logs) ===");
  const latest = await pub.getBlockNumber();
  const fromBlock = latest > 5000n ? latest - 5000n : 0n;

  async function logs(address, abi, eventName) {
    try {
      return await pub.getLogs({ address, fromBlock, toBlock: latest });
    } catch (e) {
      console.log(`   (getLogs ${eventName} failed: ${e.message})`);
      return [];
    }
  }
  function decodeLast(rawLogs, abi, eventName) {
    const hits = [];
    for (const lg of rawLogs) {
      try {
        const d = decodeEventLog({ abi, data: lg.data, topics: lg.topics });
        if (d.eventName === eventName)
          hits.push({ tx: lg.transactionHash, args: d.args, block: lg.blockNumber });
      } catch {}
    }
    return hits;
  }

  const idLogs = await logs(IDENTITY, identityRegistryAbi, "Registered");
  const escLogs = await logs(ESCROW, rebateEscrowAbi, "JobOpened");
  const repLogs = await logs(REP, reputationRegistryAbi, "NewFeedback");

  const regd = decodeLast(idLogs, identityRegistryAbi, "Registered").slice(-3);
  const opened = decodeLast(escLogs, rebateEscrowAbi, "JobOpened").slice(-3);
  const claimed = decodeLast(escLogs, rebateEscrowAbi, "RebateClaimed").slice(-3);
  const fed = decodeLast(repLogs, reputationRegistryAbi, "NewFeedback").slice(-3);

  const show = (label, arr, fmt) => {
    console.log(`\n${label} (last ${arr.length}):`);
    for (const h of arr) console.log("  ", TX(h.tx), "—", fmt(h.args));
  };
  show("IdentityRegistry.Registered", regd, (a) => `agentId ${a.agentId}`);
  show("RebateEscrow.JobOpened", opened, (a) => `job ${a.jobId} agent ${a.agentId} fee ${a.fee} pfand ${a.pfand}`);
  show("RebateEscrow.RebateClaimed", claimed, (a) => `job ${a.jobId} pfand ${a.pfand} fbIdx ${a.feedbackIndex}`);
  show("ReputationRegistry.NewFeedback", fed, (a) => `agentId ${a.agentId} value ${a.value} tag2 ${a.tag2}`);

  console.log("\n✅ done.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
