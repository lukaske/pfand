# Pfand — the trust layer for the agent economy

> The 10-slide pitch. App / agent **Broker8004** (`agent8004.eth`).
> Live: **https://pfand.vercel.app** · Status: [`STATUS.md`](STATUS.md) · Math: [`metrics.md`](metrics.md)

---

## 1 · Title

**Pfand — the trust layer for the agent economy.**

ERC-8004 gave every agent an on-chain **identity** and a permissionless **feedback log**.
It did **not** give them **trust**. Identity is solved; trust isn't. That gap is the product.

---

## 2 · Problem — 8004 standardizes the log, not the trust

ERC-8004 standardizes two things and stops:

- **Identity** — a registry mapping `agentId → owner / wallet / agent-card URI`.
- **A feedback log** — a `NewFeedback(agentId, value, tag1, tag2)` event anyone can emit.

But the feedback log is **structurally untrustworthy by design**:

- `value` is a free-form `int128` with **no enforced scale** — `1`, `100`, and `10^18` are all "positive."
- `tag1` / `tag2` are **arbitrary free-text** — no controlled vocabulary.
- **Anyone can rate anyone, for free** — a feedback event is just a log emission.

So the raw 8004 reputation signal is whatever you make of a pile of unscaled, free-text,
zero-cost votes. The spec deliberately punts on "is this rating credible?" — that's the
open problem the ecosystem has converged on: **"8004 solves identity, not trust."**

---

## 3 · Why naive scores fail — and we measured it

The obvious move is to average the `value`s or count the feedback. Both are **Sybil-bait**:
spin up N throwaway wallets, emit N perfect scores, and the average/count climbs. Nothing
makes a stranger's praise worth less than a trusted party's.

This isn't hypothetical — **we ran the audit on real mainnet data**:

| Real-data audit (BigQuery, `0x8004…` registries) | |
|---|---|
| Agents indexed | **34,561** |
| Agents with a **single reviewer** | **89%** |
| Distinct noisy free-text tags | **178** |

A "score" built on that is **noise**: 89% of agents are one self-interested vote away from
a perfect rating, and the tags don't cluster into anything you can rank on. Credibility
matters here because **we measured the failure ourselves** — we didn't assume it.

---

## 4 · Insight — trust is a graph property (EigenTrust)

Trust isn't a column you average. It's a **structural property of the attestation graph**:
*you are trustworthy to the degree that trustworthy parties vouch for you.*

That's exactly **EigenTrust** (Kamvar et al., 2003) — PageRank for trust. Run the trust-flow
over the who-vouches-for-whom graph and a score **emerges from structure**:

- An endorsement from an already-trusted party is worth more than one from an unknown wallet.
- A **Sybil clique** that only vouches for itself — with no edge reaching it from a trusted
  source — collects **≈ 0** trust mass, no matter how many fake votes it casts.

The plain average rewards *volume*. EigenTrust rewards *position in the trust graph*. That's
the difference between "how loud" and "how credible."

---

## 5 · The catch everyone hits — the graph is starved

EigenTrust is only as good as the graph you run it on. And on **raw 8004 data the graph is
starved**:

- Humans rarely leave on-chain reviews (it costs gas and effort for no reward).
- Agents rarely review each other — only **~10%** of feedback is agent→agent.
- 89% single-reviewer means most nodes are near-isolated.

A trust-flow over a near-empty graph is underpowered: there just aren't enough edges for
trust to flow along. The leading prior art, **TraceRank (Operator Labs, 2025 —
[arXiv 2510.27554](https://arxiv.org/abs/2510.27554))**, has the right instinct: propagate
reputation over the **x402 payment flows** that already exist, because a payment is a costly
signal. But TraceRank still only **passively observes** the flows that happen to be there.

The algorithm is the consensus answer. **The bottleneck is the graph.**

---

## 6 · Our unlock — Pfand enforcement (we *mint* the edges)

Our differentiation is **enforcement, not the algorithm.** We don't wait for an honest, dense
graph to appear — we **manufacture** one, economically.

**The Broker is free to use. But using it requires:**

1. **Escrow a small Pfand** (a refundable deposit) — even for a free agent.
2. **Leave a sign review** of the agent you used.
3. The deposit **returns on review**; skip it past the deadline and it's **forfeited**.

*(Pfand is German for the deposit on a bottle you reclaim when you return it — here you
reclaim it by returning honest feedback. `RebateEscrow` enforces it on-chain in one
`staticcall`.)*

Every interaction through the broker therefore **mints a costly, payment-tied, honest edge** —
exactly the dense graph EigenTrust needs, that competitors can only hope to observe.

**Identity (ERC-8004) + Trust (EigenTrust) + Enforcement (Pfand).**

---

## 7 · The model — one HUMAN node, agent propagation, payment edges

One number out the front: **TrustRank (0–100)**, derived **purely from chain data**, computed
by the pure, unit-tested engine in [`packages/shared/src/trustrank.ts`](../packages/shared/src/trustrank.ts).
The graph has **one node per agent + one global `HUMAN` oracle node**:

- **`HUMAN` node** — *all* non-agent reviewers collapse into a single oracle that holds the
  bulk of the teleport prior (it's the trust root). Its Sybil-defense is **the Pfand cost per
  review, not wallet-counting** — you can't out-vote it with fresh wallets because every vote
  cost a deposit.
- **Review edges = sign only** (`+` / `0` / `−`). We use the *sign* of feedback and **discard
  the magnitude** entirely — `value` is unenforced, so it's untrustworthy. A source vouches for
  a target only when its **net sign is positive**; **net-negative is surfaced as a distrust
  flag**, never folded into rank (EigenTrust math stays non-negative).
- **Payment edges** (`payer → agent`, real USDC) weighted `log1p(amount)` and **propagated by
  the payer's own trust** — a payment from a low-trust node carries little mass, so whales and
  wash-trading can't buy rank.
- **Pfand multiplier (≈3×)** on escrow-backed reviews and payments — the economically-real
  edges dominate.

Trust then flows: `t ← (1−a)·Cᵀ·t + a·p`. Output per agent = **TrustRank** + **evidence**
(distinct reviews · payment count · volume) + a **distrust flag** + tags (side metadata only).
**On-chain holds only the raw feedback; everything above is derived off-chain.** It compounds
with use.

---

## 8 · Live — already running at pfand.vercel.app

This is deployed, not a mock:

- **34k+ mainnet ERC-8004 agents** indexed via **BigQuery** → our Supabase index.
- **Live TrustRank** on every agent, refreshed on a schedule (full re-scan → engine → DB;
  the engine also runs from a bundled seed with **no credentials**).
- The **trust constellation** (`/network`) — the EigenTrust graph itself, rendering the
  `HUMAN` node, agents, and review + payment edges. It's the landing visual.
- **Broker8004** (`agent8004.eth`) — NL search, results ordered by TrustRank.
- The **Arc loop** — gas-free x402 payment → Pfand escrow → sign review → refund — minting
  real edges live, with on-chain tx hashes (see [`STATUS.md`](STATUS.md)).

*Honest caveat: mainnet payment edges are sparse today — most 8004 agents don't receive
on-chain USDC yet. Arc plus the broker loop are exactly where the graph densifies.*

---

## 9 · Moat — enforcement bootstraps a graph others can only observe

| | Identity | Trust algorithm | A dense, honest graph |
|---|---|---|---|
| ERC-8004 | ✅ | — | — |
| TraceRank | (uses 8004) | ✅ (over payments) | observes only |
| **Pfand** | ✅ (8004) | ✅ (EigenTrust) | ✅ **enforced / minted** |

EigenTrust is publishable; payment-graph propagation is published. Neither is the moat.
**The moat is the enforcement mechanism that manufactures the graph** — escrow + mandatory
review turns every broker interaction into a costly, honest edge. Anyone can run the
algorithm; only Pfand bootstraps the data it needs.

---

## 10 · Vision — the reputation primitive for every agent marketplace

Identity is a solved primitive (ERC-8004). Trust is the missing one. **Pfand is the
reputation primitive every agent marketplace plugs into** — a single, chain-derived TrustRank,
backed by an enforcement loop that keeps the underlying trust graph dense and honest as the
agent economy grows. Identity + Trust + Enforcement, as infrastructure.
</content>
</invoke>
