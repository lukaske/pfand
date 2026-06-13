# Pfand — Metrics, explained (v2)

> The definitive reference for every number Pfand computes about an agent: what it
> means in plain English, the formula behind it, and **why it's hard to game**. The
> engine that produces these is the pure, unit-tested
> [`packages/shared/src/trustrank.ts`](../packages/shared/src/trustrank.ts) (vendored
> for the app at `app/lib/shared/`), consumed by both the scheduled pipeline (live
> BigQuery + Arc) and the offline seed generator — **one source of truth**.
>
> Pitch framing for these numbers: [`pitch.md`](pitch.md). Pipeline diagrams:
> [`architecture.md`](architecture.md).

---

## Why a plain score is noise — and the pivot

ERC-8004 standardizes agent **identity** and a **feedback log**, but **not trust**:

- Feedback `value` is a free-form `int128` with **no enforced scale** — magnitudes are
  meaningless across raters.
- `tag1` / `tag2` are **arbitrary free-text** (our audit found **178** distinct noisy tags).
- **Anyone can rate anyone, for free** — a feedback event is just a log emission.

So an **average or count of `value`** measures *how loud* feedback is, not *how credible* it
is — and it's trivially Sybil-pumped. Our real-data audit makes this concrete: **34,561 agents
indexed, 89% with a single reviewer**. A score over that is noise.

The fix is **EigenTrust** (PageRank-for-trust, Kamvar et al. 2003) over the attestation graph:
trust **flows** from trusted parties, so a Sybil clique with no outside trust scores ≈ 0. But
EigenTrust is only as good as the graph, and the raw 8004 graph is **starved** (humans rarely
review; only ~10% of feedback is agent→agent). So Pfand **enforces** a dense graph — escrow +
mandatory sign review to use the broker — and we run EigenTrust over **review edges + real
payment edges**, with all non-agent reviewers collapsed into one **HUMAN** oracle node.

**On-chain vs derived.** Only the **raw ERC-8004 feedback** (and real USDC transfers) live
on-chain. **Everything below — TrustRank, evidence, the distrust flag — is derived off-chain**
by the engine. And the engine **deliberately ignores the `value` magnitude**: it uses only the
**sign**.

---

## The metrics at a glance

| Metric | What it answers | Range | Game-resistance |
|---|---|---|---|
| **TrustRank** | How trustworthy is this agent overall? | 0–100 (`null` = no inbound edge) | Trust *flows* from a HUMAN-seeded root; a Sybil clique with no edge reaching it earns ~0. |
| **Evidence** | How much real backing is behind that rank? | counts + USDC | Each unit (review, payment) cost effort/money; the Pfand loop makes it costly to fake. |
| **Distrust flag** | Is net sentiment negative? | boolean | Surfaced separately, never as negative rank (keeps EigenTrust non-negative). |
| **Pfand multiplier** | Is this edge economically real? | ×K (K≈3) | Escrow-backed reviews/payments dominate the graph. |
| **Tags** | What is it *known for*? | free-text chips | **Side metadata only** — never feeds rank, so junk tags can't move the score. |

---

## The graph — one HUMAN node + one node per agent

Nodes are: **one node per agent** (`${network}:${agentId}`) **plus one global `HUMAN` oracle
node**. Every edge points **toward an agent**, and a source is resolved as follows:

- A review's `client` (or a payment's `from`) is lowercased and matched against the
  `(owner | payToWallet) → agentId` map.
- If it maps to a known agent → the source is **that agent node** (real **agent→agent**
  propagation — the lines in the `/network` constellation).
- Otherwise → the source is the single **`HUMAN`** oracle node.

**Why collapse all humans into one node?** Per-human Sybil-resistance would mean trusting
wallet-counting — and wallets are free. Instead, `HUMAN`'s defense is the **Pfand cost per
review**: each human vote that matters cost a deposit, so you can't out-vote the oracle with
fresh wallets. *(This is an intentional trade: per-human Sybil-resistance for Pfand-cost
Sybil-resistance.)* A self-rating (`source === target`) is dropped — you can't vouch for
yourself.

---

## 1 · Review edges — sign only

**Plain English.** A review is a **vote**, not a magnitude. We read only its **sign** and throw
the `value` number away, because the scale is unenforced and therefore untrustworthy.

**Sign of one review** (`reviewSign`):

```
tag2 == "success"  →  +1
tag2 == "fail"     →  −1
else value > 0     →  +1
     value < 0     →  −1
     value == 0    →   0
```

**Aggregate per (source → target).** Sum the signs into `net = (#positive − #negative)`. The
edge only **vouches** when `net > 0`; its weight is the sum of the **positive** contributions:

```
reviewWeight(source→agent) = (net > 0)  ?  Σ over positive reviews of [ 1 · decay · pfandMult ]  :  0
```

- `decay = 0.5^(ageDays / halfLife)`, `halfLife ≈ 180d` — recent reviews matter more; you can't
  coast on stale praise. (Decay is disabled when the caller passes no `nowMs`.)
- `pfandMult = K (≈3)` when the review is Pfand-backed (`tag2 ∈ {success, fail, pfand-demo}` or
  a `pfand` tag), else `1`.

**Distrust flag.** A per-agent **net feedback sign** is tracked across *all* sources. When it's
negative, the agent gets `distrustFlag = true`, surfaced in the UI **separately** — never folded
into rank as a negative number (EigenTrust requires non-negative weights).

**Why it resists gaming.** Magnitude inflation is impossible — `value = 10^18` and `value = 1`
are the same `+1`. A spammer can't pump a number; they can only cast more **signs**, and from
the `HUMAN` node those signs cost Pfand. A clique that net-distrusts a target contributes **0**
weight (not negative), so it can't be weaponized to drive an eigenvector negative.

---

## 2 · Payment edges — real money, propagated by the payer's trust

**Plain English.** A **payment is a costly vote.** Paying an agent (x402/USDC) creates a
`payer → agent` edge — but the lift it gives depends on **how trusted the payer is**, so you
can't buy rank with a fresh wallet.

**Edge weight:**

```
payWeight(payer→agent) = log1p(amountUsdc) · decay · (pfandVerified ? K : 1)
```

- `log1p(amount)` — diminishing returns on size, so one whale transfer can't dominate.
- `decay` — same 180-day half-life.
- `pfandVerified` — escrow-backed payments get the `×K` boost.

The "weight by **who** pays" requirement is handled **automatically by the propagation itself**:
a payment from a low-trust node carries little eigenvector mass, so it lifts the target only a
little. This is the **TraceRank** insight (Operator Labs, 2025) — propagate over payment flows —
made into an *enforced*, not merely observed, input.

**Combine.** The final raw edge weight is `reviewWeight + payWeight` per `(source → target)`;
edges with weight ≤ 0 are dropped.

**Why it resists gaming.** Wash-trading buys you `log1p($)` weight scaled by **your own trust** —
and a Sybil payer has ~0 trust, so the payment lifts nothing. Real money from a real, trusted
counterparty is what moves the number.

> **Honest caveat.** Mainnet payment edges are **sparse today** — most 8004 agents don't yet
> receive on-chain USDC. **Arc** (our own x402 transfers) and the **broker loop** are where the
> payment graph densifies.

---

## 3 · The Pfand multiplier (`K ≈ 3`) — the moat, made mathematical

**Plain English.** An edge backed by an on-chain **Pfand** — a review or payment that locked a
real deposit tied to a real x402 payment — counts roughly **3×** a plain, unbacked one.

Anyone can emit a `NewFeedback` log for free; only a Pfand-backed edge cost the rater a **locked
deposit + a settled payment**. Weighting these `×K` makes the **economically-real edges dominate**
the graph — so the index is structurally harder to fake than one scraped from public events.

**Sentiment-neutral.** `RebateEscrow.claimRebate` refunds on *fresh, non-revoked* feedback
**regardless of sentiment** — a "fail" refunds exactly like a "success." So the boost rewards
**honest, costly** feedback, not **flattering** feedback.

---

## 4 · TrustRank — the EigenTrust iteration

**Plain English.** TrustRank is the stationary distribution of a trust random-walk seeded at the
`HUMAN` root — the same core idea as PageRank, the reputation variant being EigenTrust.

**Local-trust matrix `C`.** Row-normalize each source's outgoing weights so each source's trust
sums to 1 (row-stochastic).

**HUMAN-seeded prior `p`.** Place `humanPrior` (default **0.9**) of the teleport mass on `HUMAN`
and spread `1 − humanPrior` uniformly over **rated** agents (those with ≥1 inbound edge), then
normalize to sum 1. Trust **originates** from the human oracle and economically-backed sources.

**The iteration:**

```
t ← (1 − a) · Cᵀ · t  +  a · p
```

- `Cᵀ` — transposed local-trust matrix (trust flowing **into** each node).
- `a = 0.15` — teleport / restart constant (`teleport`).
- `p` — the HUMAN-seeded prior above.

Iterate to convergence (≤100 power-iterations, stop at L1 `Δ < 1e-9`). Dangling nodes (no out-
edges) leak their mass to teleport. The graph is small, so this converges in sub-second time.
**`HUMAN`'s mass then splits across the agents it endorsed**, weighted by net-positive,
Pfand-gated review/payment counts — so review/payment **volume now matters** (because each unit
cost money), **without ever trusting the `value` magnitude**.

**Outputs.**

- **`trustRankRaw`** — the raw eigenvector value (tiny, skewed). Used for bubble **area** in
  `/network` (on a sqrt scale). `null` if the agent has no inbound edge.
- **`trustRank` (0–100)** — `trustRankRaw`'s **percentile** among all rated agents **pooled
  across both networks** (mainnet + Arc). Top ≈ 100, median ≈ 50. This is the headline number on
  badges, cards, and the leaderboard. (A lone rated agent percentiles to 100.)

**Why it resists gaming.** A Sybil swarm endorsing a fake agent — with no edge reaching it from
`HUMAN` or a trusted/paying party — collects ≈ 0 eigenvector mass. To move the number you must
be trusted **by the already-trusted**, or **paid by a trusted payer**, both of which are costly
to fake. (The engine ships with a Sybil unit test: a clique with no HUMAN/payment edge → ~0.)

---

## 5 · Evidence & supporting quantities

- **Evidence** `{ distinctReviews, paymentCount, paymentVolumeUsdc }` — the
  **confidence / anti-Sybil signal** shown next to the rank. `distinctReviews` = unique
  non-revoked rater addresses; `paymentCount` / `paymentVolumeUsdc` = payments received and total
  USDC. A high rank with one review and no payments is visibly thin backing; a high rank with many
  paid reviews is robust.

- **Distrust flag** — `true` when an agent's **net feedback sign is negative**. A warning surfaced
  beside the rank, **never** a negative TrustRank.

- **Tags** — top `tag1` free-text labels by count (capped ~6), exposed as a small **"known for: …"**
  chip row. **Side metadata only — tags never feed TrustRank**, so the 178 noisy free-text tags
  can't be used to game the score. `topTask = tags[0]` is kept for back-compat / `/network`
  coloring.

- **Unrated agents** — an agent with no inbound edge gets `trustRank = null`, shown as **"unrated"**
  (never `0`, which would falsely imply a bad reputation) and **excluded** from the `/network`
  constellation.

---

## How and when scores refresh

Scores are recomputed on a schedule and persisted to Supabase; the app reads the live DB, with the
static seed as a no-credentials fallback.

- **Trigger.** Vercel Cron → token-guarded `POST /api/cron/recompute`, schedule `0 */3 * * *`
  (every ~3h).
- **Full re-scan, no watermark.** Each run re-queries BigQuery for *all* `Registered` /
  `NewFeedback` events from the two `0x8004…` registries and ingests Arc events + payment flows,
  idempotently upserts into Supabase, loads the full set, and runs the engine. No incremental state
  to get wrong; a re-run can only converge to the same answer.
- **Stamp.** The UI surfaces a "scores updated &lt;relative time&gt;" stamp from
  `trustrank_updated_at`.

> **Note.** The cron *refreshing* requires GCP + Supabase credentials. The engine and live scoring
> work from the bundled seed **with no credentials** — the seed is generated by the same engine
> offline, so the math is identical either way.

See [`architecture.md`](architecture.md) for the full pipeline diagram, the v2 graph, and the
`/network` + Broker8004 flows.
</content>
