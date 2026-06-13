import { test } from "node:test";
import assert from "node:assert/strict";

import type { Agent, FeedbackEntry, Payment, AgentNetwork } from "./db";
import { scoreAgents } from "./trustrank.ts";

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
  const value = opts.value ?? 100;
  return {
    agentId,
    network: opts.network ?? "arc",
    client,
    feedbackIndex: fbCounter++,
    value,
    valueDecimals: opts.valueDecimals ?? 2,
    score: opts.score ?? value / 100,
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

function mkPayment(
  toAgentId: string,
  from: string,
  amountUsdc: number,
  opts: Partial<Payment> & { network?: AgentNetwork } = {},
): Payment {
  return {
    from,
    toAgentId,
    network: opts.network ?? "arc",
    amountUsdc,
    timestamp: opts.timestamp ?? null,
    pfandVerified: opts.pfandVerified,
  };
}

const key = (network: string, agentId: string) => `${network}:${agentId}`;

// ---------------------------------------------------------------------------
// 1. HUMAN-seed propagation: an agent positively reviewed by HUMAN outranks an
//    agent with no edges at all (which is null/unrated).
// ---------------------------------------------------------------------------
test("HUMAN-seed propagation: HUMAN-reviewed agent outranks an unrated agent", () => {
  const agents = [mkAgent("X"), mkAgent("UNRATED")];
  // Reviewer is an anonymous wallet → source resolves to HUMAN.
  const feedback = [mkFeedback("X", "0xanon", { value: 100 })];

  const scores = scoreAgents(feedback, agents);
  const X = scores.get(key("arc", "X"))!;
  const U = scores.get(key("arc", "UNRATED"))!;

  assert.ok(X.trustRankRaw !== null, "X should be rated");
  assert.equal(U.trustRankRaw, null, "unrated agent has no inbound edge");
  assert.equal(U.trustRank, null);
  assert.ok(X.trustRankRaw! > 0);
});

// ---------------------------------------------------------------------------
// 2. Sign aggregation: net +2 outranks net 0; net negative → distrustFlag and
//    is NOT propagated (reviewWeight 0).
// ---------------------------------------------------------------------------
test("sign aggregation: net +2 outranks net 0; net-negative gets distrustFlag and no propagation", () => {
  const agents = [mkAgent("POS"), mkAgent("ZERO"), mkAgent("NEG")];
  const feedback: FeedbackEntry[] = [
    // POS: 3 positive, 1 negative → net +2
    mkFeedback("POS", "0xa1", { value: 50 }),
    mkFeedback("POS", "0xa2", { value: 50 }),
    mkFeedback("POS", "0xa3", { value: 50 }),
    mkFeedback("POS", "0xa4", { value: -50 }),
    // ZERO: 1 positive, 1 negative → net 0
    mkFeedback("ZERO", "0xb1", { value: 50 }),
    mkFeedback("ZERO", "0xb2", { value: -50 }),
    // NEG: 2 negative → net -2
    mkFeedback("NEG", "0xc1", { value: -50 }),
    mkFeedback("NEG", "0xc2", { value: -50 }),
  ];

  const scores = scoreAgents(feedback, agents);
  const POS = scores.get(key("arc", "POS"))!;
  const ZERO = scores.get(key("arc", "ZERO"))!;
  const NEG = scores.get(key("arc", "NEG"))!;

  // POS has positive net → propagated. ZERO has net 0 → reviewWeight 0 → no edge.
  assert.ok(POS.trustRankRaw !== null && POS.trustRankRaw! > 0);
  assert.equal(ZERO.trustRankRaw, null, "net 0 produces no vouch edge");
  assert.equal(NEG.trustRankRaw, null, "net negative produces no vouch edge");

  assert.equal(POS.distrustFlag, false);
  assert.equal(NEG.distrustFlag, true, "net-negative agent flagged");
  assert.equal(ZERO.distrustFlag, false, "net 0 is not distrust");
});

// ---------------------------------------------------------------------------
// 3. Payment propagation by trust: an equal-amount payment from a high-trust
//    agent lifts the target more than from a freshly-seen leaf payer.
// ---------------------------------------------------------------------------
test("payment propagation: payment from a high-trust agent lifts target more than from a leaf payer", () => {
  // HUB is heavily HUMAN-endorsed → high trust. It pays HIGHTGT.
  // LEAF is a never-reviewed wallet (resolves to HUMAN as source only if mapped;
  // an unmapped payer routes to HUMAN). To get a genuine LOW-trust agent payer,
  // we use agent LP that is reviewed exactly once (low trust) and pays LOWTGT.
  const agents = [
    mkAgent("HUB", { owner: "0xHUB" }),
    mkAgent("LP", { owner: "0xLP" }),
    mkAgent("HIGHTGT"),
    mkAgent("LOWTGT"),
  ];
  const feedback: FeedbackEntry[] = [];
  // HUB earns lots of HUMAN trust.
  for (let i = 0; i < 10; i++) {
    feedback.push(mkFeedback("HUB", `0xhumanfan${i}`, { value: 100 }));
  }
  // LP earns one weak HUMAN review.
  feedback.push(mkFeedback("LP", "0xoneoff", { value: 100 }));

  const payments: Payment[] = [
    mkPayment("HIGHTGT", "0xHUB", 100), // from high-trust agent
    mkPayment("LOWTGT", "0xLP", 100), // from low-trust agent, equal amount
  ];

  const scores = scoreAgents(feedback, agents, { payments });
  const HIGH = scores.get(key("arc", "HIGHTGT"))!;
  const LOW = scores.get(key("arc", "LOWTGT"))!;

  assert.ok(HIGH.trustRankRaw !== null && LOW.trustRankRaw !== null);
  assert.ok(
    HIGH.trustRankRaw! > LOW.trustRankRaw!,
    `high-trust-funded (${HIGH.trustRankRaw}) should beat low-trust-funded (${LOW.trustRankRaw})`,
  );
  // Evidence is recorded.
  assert.equal(HIGH.evidence.paymentCount, 1);
  assert.equal(HIGH.evidence.paymentVolumeUsdc, 100);
});

// ---------------------------------------------------------------------------
// 4. Pfand multiplier: pfand-verified review/payment outranks an equal
//    non-pfand one — routed through a shared HUB so row-normalization makes the
//    boost observable.
// ---------------------------------------------------------------------------
test("pfand multiplier: pfand-verified review outranks identical non-pfand review", () => {
  const agents = [
    mkAgent("HUB", { owner: "0xPFANDHUB" }),
    mkAgent("P"),
    mkAgent("N"),
  ];
  const feedback: FeedbackEntry[] = [];
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xpfanfan${i}`, { value: 100 }));
  }
  // HUB endorses both; only P's review is pfand-verified.
  feedback.push(mkFeedback("P", "0xPFANDHUB", { value: 100, tag2: "pfand-demo" }));
  feedback.push(mkFeedback("N", "0xPFANDHUB", { value: 100, tag2: "" }));

  const scores = scoreAgents(feedback, agents);
  const P = scores.get(key("arc", "P"))!;
  const N = scores.get(key("arc", "N"))!;

  assert.ok(P.trustRankRaw !== null && N.trustRankRaw !== null);
  assert.ok(
    P.trustRankRaw! > N.trustRankRaw!,
    `pfand (${P.trustRankRaw}) should outrank non-pfand (${N.trustRankRaw})`,
  );
});

test("pfand multiplier (payment): verified payment outranks equal unverified payment", () => {
  const agents = [
    mkAgent("HUB", { owner: "0xPAYHUB" }),
    mkAgent("PV"),
    mkAgent("PU"),
  ];
  const feedback: FeedbackEntry[] = [];
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xpayfan${i}`, { value: 100 }));
  }
  const payments: Payment[] = [
    mkPayment("PV", "0xPAYHUB", 100, { pfandVerified: true }),
    mkPayment("PU", "0xPAYHUB", 100, { pfandVerified: false }),
  ];

  const scores = scoreAgents(feedback, agents, { payments });
  const PV = scores.get(key("arc", "PV"))!;
  const PU = scores.get(key("arc", "PU"))!;

  assert.ok(PV.trustRankRaw !== null && PU.trustRankRaw !== null);
  assert.ok(
    PV.trustRankRaw! > PU.trustRankRaw!,
    `verified (${PV.trustRankRaw}) should outrank unverified (${PU.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// 5. Recency: a 400-day-old review yields a lower raw than an identical recent
//    one (routed through a shared HUB so decay affects the normalized split).
// ---------------------------------------------------------------------------
test("recency: a 400-day-old review yields lower raw than an identical recent one", () => {
  const nowMs = Date.parse("2026-06-12T00:00:00.000Z");
  const recentTs = "2026-06-11T00:00:00.000Z"; // ~1 day → decay ≈ 1
  const oldTs = "2025-05-08T00:00:00.000Z"; // ~400 days → decay ≈ 0.21

  const agents = [
    mkAgent("HUB", { owner: "0xDECAYHUB" }),
    mkAgent("RECENT"),
    mkAgent("OLD"),
  ];
  const feedback: FeedbackEntry[] = [];
  for (let i = 0; i < 5; i++) {
    feedback.push(mkFeedback("HUB", `0xhubfan${i}`, { value: 100 }));
  }
  feedback.push(
    mkFeedback("RECENT", "0xDECAYHUB", { value: 100, timestamp: recentTs }),
  );
  feedback.push(
    mkFeedback("OLD", "0xDECAYHUB", { value: 100, timestamp: oldTs }),
  );

  const scores = scoreAgents(feedback, agents, { nowMs, halfLifeDays: 180 });
  const RECENT = scores.get(key("arc", "RECENT"))!;
  const OLD = scores.get(key("arc", "OLD"))!;

  assert.ok(RECENT.trustRankRaw !== null && OLD.trustRankRaw !== null);
  assert.ok(
    RECENT.trustRankRaw! > OLD.trustRankRaw!,
    `recent (${RECENT.trustRankRaw}) should beat old (${OLD.trustRankRaw})`,
  );
});

// ---------------------------------------------------------------------------
// 6. Sybil clique: N agents that only review each other, with NO HUMAN/payment
//    edge into the clique, collect ~0 trust vs a HUMAN-endorsed agent.
// ---------------------------------------------------------------------------
test("sybil clique: a closed review clique gets ~0 trust vs a HUMAN-endorsed agent", () => {
  const N = 5;
  const agents: Agent[] = [mkAgent("LEGIT")];
  for (let i = 0; i < N; i++) {
    agents.push(mkAgent(`S${i}`, { owner: `0xsyb${i}` }));
  }

  const feedback: FeedbackEntry[] = [];
  // LEGIT is endorsed by HUMAN (anonymous wallet).
  feedback.push(mkFeedback("LEGIT", "0xrealhuman", { value: 100 }));
  // The clique only reviews itself — each Si reviews S(i+1). No HUMAN edge in,
  // because every reviewer maps to a clique agent.
  for (let i = 0; i < N; i++) {
    const reviewer = `0xsyb${i}`;
    const target = `S${(i + 1) % N}`;
    feedback.push(mkFeedback(target, reviewer, { value: 100 }));
  }

  const teleport = 0.15;
  const humanPrior = 0.9;
  const scores = scoreAgents(feedback, agents, { teleport, humanPrior });
  const LEGIT = scores.get(key("arc", "LEGIT"))!;
  assert.ok(LEGIT.trustRankRaw !== null && LEGIT.trustRankRaw! > 0);

  // ratedCount = LEGIT + N clique members. Every rated agent gets an equal
  // teleport-prior floor of (1 - humanPrior) / ratedCount. The Sybil-resistance
  // property: the closed clique gains ZERO amplification beyond that floor —
  // all of HUMAN's propagated mass flows to LEGIT, none into the clique.
  const ratedCount = N + 1;
  const floor = (1 - humanPrior) / ratedCount;
  for (let i = 0; i < N; i++) {
    const S = scores.get(key("arc", `S${i}`))!;
    const sybRaw = S.trustRankRaw ?? 0;
    // No amplification: clique member never exceeds its bare teleport floor.
    assert.ok(
      sybRaw <= floor + 1e-9,
      `clique member S${i} (${sybRaw}) should not amplify beyond floor (${floor})`,
    );
    // And it is dwarfed by the HUMAN-endorsed LEGIT.
    assert.ok(
      sybRaw < LEGIT.trustRankRaw! * 0.25,
      `clique member S${i} (${sybRaw}) should be small vs LEGIT (${LEGIT.trustRankRaw})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Sanity: unrated agents, network partition, evidence/tags shape, back-compat.
// ---------------------------------------------------------------------------
test("unrated agents return null; networks stay partitioned; evidence/tags populate", () => {
  const agents = [
    mkAgent("A", { network: "arc" }),
    mkAgent("UNRATED", { network: "arc" }),
    mkAgent("M", { network: "mainnet" }),
  ];
  const feedback = [
    mkFeedback("A", "0xc1", { network: "arc", value: 100, tag1: "coding" }),
    mkFeedback("A", "0xc2", { network: "arc", value: 100, tag1: "coding" }),
    mkFeedback("A", "0xc3", { network: "arc", value: 100, tag1: "design" }),
    mkFeedback("M", "0xc4", { network: "mainnet", value: 100 }),
  ];

  const scores = scoreAgents(feedback, agents);

  const A = scores.get(key("arc", "A"))!;
  assert.ok(A.trustRankRaw !== null);
  assert.equal(A.evidence.distinctReviews, 3);
  assert.deepEqual(A.tags, [
    { tag: "coding", count: 2 },
    { tag: "design", count: 1 },
  ]);
  assert.equal(A.topTask, "coding");

  const U = scores.get(key("arc", "UNRATED"))!;
  assert.equal(U.trustRank, null);
  assert.equal(U.trustRankRaw, null);
  assert.deepEqual(U.tags, []);
  assert.equal(U.topTask, null);
  assert.equal(U.evidence.distinctReviews, 0);
  assert.equal(U.distrustFlag, false);

  // mainnet agent stays separately rated (no cross-network edges).
  const M = scores.get(key("mainnet", "M"))!;
  assert.ok(M.trustRankRaw !== null);
});

test("scoreAgents is callable with no payments (v1 back-compat)", () => {
  const agents = [mkAgent("Z")];
  const feedback = [mkFeedback("Z", "0xz1", { value: 100 })];
  const scores = scoreAgents(feedback, agents); // no opts at all
  assert.ok(scores.get(key("arc", "Z"))!.trustRankRaw !== null);
});
