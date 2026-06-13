import { test } from "node:test";
import assert from "node:assert/strict";

import type { Agent, FeedbackEntry, AgentNetwork } from "./db";
import { scoreAgents, buildTrustGraph, computeEigenTrust } from "./trustrank.ts";

// ---------------------------------------------------------------------------
// Inline builders for deterministic fixtures (no randomness, no real Date).
// ---------------------------------------------------------------------------

let fbCounter = 0;

function mkAgent(
  agentId: string,
  opts: Partial<Agent> & { network?: AgentNetwork } = {},
): Agent {
  return {
    agentId,
    network: opts.network ?? "arc",
    owner: opts.owner ?? `0xowner${agentId}`,
    agentURI: "",
    name: opts.name ?? `agent-${agentId}`,
    description: "",
    image: null,
    skills: [],
    domains: [],
    x402Support: false,
    serviceEndpoint: null,
    payToWallet: opts.payToWallet ?? null,
    ensName: null,
    payable: false,
    priceUsdc: null,
    reputation: {
      count: 0,
      score: null,
      scoreNormalized: null,
      trustRank: null,
      trustRankRaw: null,
      scoresByTask: [],
      distinctClients: 0,
      topTask: null,
    },
    createdAtBlock: null,
    createdAt: null,
    ...opts,
  };
}

function mkFeedback(
  agentId: string,
  client: string,
  opts: Partial<FeedbackEntry> & { network?: AgentNetwork } = {},
): FeedbackEntry {
  const score = opts.score ?? 100;
  return {
    agentId,
    network: opts.network ?? "arc",
    client,
    feedbackIndex: fbCounter++,
    value: opts.value ?? Math.round(score * 100),
    valueDecimals: opts.valueDecimals ?? 2,
    score,
    tag1: opts.tag1 ?? "general",
    tag2: opts.tag2 ?? "",
    feedbackURI: "",
    isRevoked: opts.isRevoked ?? false,
    txHash: null,
    blockNumber: null,
    timestamp: opts.timestamp ?? null,
    ...opts,
  };
}

const key = (network: string, agentId: string) => `${network}:${agentId}`;

// ---------------------------------------------------------------------------
// 1. Ranking: an endorsement from a high-trust agent beats a fresh leaf wallet.
// ---------------------------------------------------------------------------
test("ranking: endorsement from a trusted agent outranks a leaf-wallet endorsement", () => {
  // Hub H is heavily endorsed by many leaf clients → high trust.
  // H then endorses X. Y is endorsed only by one fresh anonymous leaf wallet.
  const agents = [
    mkAgent("H", { owner: "0xHUB" }),
    mkAgent("X"),
    mkAgent("Y"),
  ];
  const feedback: FeedbackEntry[] = [];
  // Many clients endorse the hub → hub accumulates trust.
  for (let i = 0; i < 10; i++) {
    feedback.push(mkFeedback("H", `0xfan${i}`, { score: 100 }));
  }
  // The hub (client addr 0xHUB maps to agent H) endorses X.
  feedback.push(mkFeedback("X", "0xHUB", { score: 100 }));
  // A single fresh leaf wallet endorses Y.
  feedback.push(mkFeedback("Y", "0xrandomfresh", { score: 100 }));

  const scores = scoreAgents(feedback, agents);
  const X = scores.get(key("arc", "X"))!;
  const Y = scores.get(key("arc", "Y"))!;

  assert.ok(X.trustRankRaw !== null && Y.trustRankRaw !== null);
  assert.ok(
    X.trustRankRaw! > Y.trustRankRaw!,
    `expected X (${X.trustRankRaw}) > Y (${Y.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// 2. Sybil resistance: a flood of throwaway wallets cannot out-rank an agent
//    endorsed by a genuinely-trusted agent.
// ---------------------------------------------------------------------------
test("sybil resistance: 1000 throwaway raters do not dominate a real endorsement", () => {
  const agents = [
    mkAgent("SYBIL"), // boosted by a sock-puppet army
    mkAgent("HUB", { owner: "0xREALHUB" }), // a legitimately-trusted agent
    mkAgent("LEGIT"), // endorsed once, by HUB
  ];

  const feedback: FeedbackEntry[] = [];

  // 1000 distinct fake leaf wallets each rate SYBIL 100. None of these wallets
  // is itself rated, so they hold zero prior trust mass.
  for (let i = 0; i < 1000; i++) {
    feedback.push(mkFeedback("SYBIL", `0xsybil${i}`, { score: 100 }));
  }

  // HUB earns real trust from a handful of (also-rated... here leaf, but the
  // point is HUB is an *agent* that then propagates trust) clients.
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xrealclient${i}`, { score: 100 }));
  }
  // HUB (owner 0xREALHUB) endorses LEGIT a single time.
  feedback.push(mkFeedback("LEGIT", "0xREALHUB", { score: 100 }));

  const scores = scoreAgents(feedback, agents);
  const SYBIL = scores.get(key("arc", "SYBIL"))!;
  const LEGIT = scores.get(key("arc", "LEGIT"))!;

  assert.ok(SYBIL.trustRankRaw !== null && LEGIT.trustRankRaw !== null);
  // The single endorsement from a trust-propagating agent should be at least as
  // strong as 1000 endorsements from trustless throwaway wallets.
  assert.ok(
    LEGIT.trustRankRaw! >= SYBIL.trustRankRaw!,
    `legit (${LEGIT.trustRankRaw}) should be >= sybil (${SYBIL.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// 3. Pfand boost: identical setups, but the pfand-verified agent outranks.
// ---------------------------------------------------------------------------
test("pfand boost: pfand-verified feedback outranks identical non-pfand feedback", () => {
  // A shared trusted HUB endorses both P and N identically, except P's feedback
  // is pfand-verified (tag2="pfand-demo") and N's is plain. The pfand boost
  // (×3) gives P a larger share of HUB's weight-normalized outflow, so P ends
  // with a strictly higher eigenvector value.
  const agents = [
    mkAgent("HUB", { owner: "0xPFANDHUB" }),
    mkAgent("P"),
    mkAgent("N"),
  ];
  const feedback: FeedbackEntry[] = [];
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xpfanfan${i}`, { score: 100 }));
  }
  feedback.push(
    mkFeedback("P", "0xPFANDHUB", { score: 100, tag2: "pfand-demo" }),
  );
  feedback.push(mkFeedback("N", "0xPFANDHUB", { score: 100, tag2: "" }));

  const scores = scoreAgents(feedback, agents);
  const P = scores.get(key("arc", "P"))!;
  const N = scores.get(key("arc", "N"))!;

  assert.ok(P.trustRankRaw !== null && N.trustRankRaw !== null);
  assert.ok(
    P.trustRankRaw! > N.trustRankRaw!,
    `pfand agent (${P.trustRankRaw}) should outrank non-pfand (${N.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// 4. Time decay: old feedback yields a lower raw than identical recent feedback.
// ---------------------------------------------------------------------------
test("time decay: older feedback yields a lower raw than recent feedback", () => {
  const nowMs = Date.parse("2026-06-12T00:00:00.000Z");
  const recentTs = "2026-06-11T00:00:00.000Z"; // ~1 day old → decay ≈ 1
  const oldTs = "2025-05-08T00:00:00.000Z"; // ~400 days old → decay ≈ 0.21

  // A shared trusted HUB endorses both RECENT and OLD with otherwise-identical
  // feedback; only the timestamp differs. Because the local-trust row is
  // weight-normalized, the decayed (old) edge receives a smaller share of HUB's
  // outflow, so RECENT ends with a strictly larger eigenvector value.
  const agents = [
    mkAgent("HUB", { owner: "0xDECAYHUB" }),
    mkAgent("RECENT"),
    mkAgent("OLD"),
  ];
  const feedback: FeedbackEntry[] = [];
  // Give HUB real trust from leaf clients.
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xhubfan${i}`, { score: 100 }));
  }
  // HUB endorses both — identical except for the timestamp.
  feedback.push(
    mkFeedback("RECENT", "0xDECAYHUB", { score: 100, timestamp: recentTs }),
  );
  feedback.push(
    mkFeedback("OLD", "0xDECAYHUB", { score: 100, timestamp: oldTs }),
  );

  const scores = scoreAgents(feedback, agents, {
    nowMs,
    halfLifeDays: 180,
  });
  const RECENT = scores.get(key("arc", "RECENT"))!;
  const OLD = scores.get(key("arc", "OLD"))!;

  assert.ok(RECENT.trustRankRaw !== null && OLD.trustRankRaw !== null);
  assert.ok(
    RECENT.trustRankRaw! > OLD.trustRankRaw!,
    `recent (${RECENT.trustRankRaw}) should beat old (${OLD.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// Sanity: graph/eigentrust plumbing + unrated agents + network partition.
// ---------------------------------------------------------------------------
test("unrated agents return null trust and networks stay partitioned", () => {
  const agents = [
    mkAgent("A", { network: "arc" }),
    mkAgent("UNRATED", { network: "arc" }),
    mkAgent("M", { network: "mainnet" }),
  ];
  const feedback = [
    mkFeedback("A", "0xc1", { network: "arc", score: 100 }),
    mkFeedback("M", "0xc2", { network: "mainnet", score: 100 }),
  ];

  const graph = buildTrustGraph(feedback, agents);
  // No edge should ever cross networks.
  for (const e of graph.edges) {
    if (e.from.startsWith("client:")) continue;
    assert.equal(
      e.from.split(":")[0],
      e.to.split(":")[0],
      "edge crosses networks",
    );
  }
  const raw = computeEigenTrust(graph);
  assert.ok(raw.has(key("arc", "A")));
  assert.ok(raw.has(key("mainnet", "M")));
  assert.ok(!raw.has(key("arc", "UNRATED")));

  const scores = scoreAgents(feedback, agents);
  const U = scores.get(key("arc", "UNRATED"))!;
  assert.equal(U.trustRank, null);
  assert.equal(U.trustRankRaw, null);
  assert.deepEqual(U.scoresByTask, []);
  assert.equal(U.topTask, null);
  assert.equal(U.distinctClients, 0);
});
