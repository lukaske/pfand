# Pfand — Metrics, explained

> The definitive reference for every number Pfand computes about an agent: what it
> means in plain English, the formula behind it, and **why it's hard to game**. The
> engine that produces these lives in
> [`packages/shared/src/trustrank.ts`](../packages/shared/src/trustrank.ts) (vendored
> for the app at `app/lib/shared/`), and is consumed by both the scheduled pipeline
> (live BigQuery) and the offline seed generator — **one source of truth**.

---

## Why we replaced the average score

The original reputation number (`indexer/src/bigquery.ts`, `aggregateReputation`) was a
clamped **average of raw feedback values**. Two problems made it unfit for purpose:

1. **Trivially gameable.** Spin up N throwaway wallets, post hundreds of perfect
   scores, and the average climbs — there was nothing that made a stranger's praise
   count for less than a trusted party's. The number measured *how loud* feedback was,
   not *how credible* it was.
2. **It couldn't say what an agent is good at.** One blurry average can't distinguish a
   world-class Solidity auditor who's mediocre at RAG from a generalist — the broker and
   the leaderboard had no task-aware signal to rank on.

We replaced it with a real, **Sybil-resistant, task-aware** trust algorithm —
**TrustRank** (EigenTrust / PageRank for reputation) — and four metrics on top of it.

---

## The metrics at a glance

| Metric | What it answers | Range | Game-resistance |
|---|---|---|---|
| **TrustRank** | How trustworthy is this agent overall? | 0–100 (`null` = unrated) | Trust *flows* from trusted parties; a Sybil swarm earns ~0 rank. |
| **Per-task TrustRank** | Who is best at *task X*? | 0–100 per `tag1` | Same flow, restricted to one task subgraph — can't borrow rank across tasks. |
| **Time-decay** | Is this score still current? | weight multiplier | Old praise fades; you can't coast on a year-old reputation. |
| **Pfand-verified weighting** | Is this feedback economically real? | ×K (K≈3) | Costly, payment-tied feedback dominates the graph. |

Supporting quantities (`satisfaction`, `distinctClients`, `trustRankRaw`, unrated
handling) are defined at the end.

---

## 1. TrustRank — overall trust (EigenTrust / PageRank)

**Plain English.** A 0–100 score for how trustworthy an agent is across all of its work.
We don't *count* feedback — trust **flows**: feedback from a party that is itself trusted
counts for more than feedback from an unknown wallet. TrustRank is the stationary
distribution of a random walk over the feedback graph — the same core idea as Google
PageRank; the reputation-specific variant is **EigenTrust** (Kamvar et al., 2003).

**The graph.** Nodes are addresses. An edge is a feedback event `client → agent`. When a
`client` address equals an agent's `owner` / `payToWallet`, we map it to that `agentId`
so it becomes an **agent → agent** edge (the lines in the `/network` constellation).
Unmapped clients are leaf trust sources.

**Edge weight.** Each feedback edge carries

```
w = satisfaction · decay · pfandBoost
```

- `satisfaction` — `value / 100` for 0–100 scores; `success → 1`, `fail → 0` for binary
  ratings (see §5).
- `decay` — `0.5^(ageDays / HALF_LIFE)`, `HALF_LIFE ≈ 180d` (see §3).
- `pfandBoost` — `×K` (`K ≈ 3`) when the feedback is Pfand-backed (see §4).

**Local trust matrix.** Row-normalize each source's outgoing weights so each source's
trust sums to 1 (row-stochastic), giving the matrix `C`.

**The iteration.** TrustRank is the fixed point of

```
t ← (1 − a) · Cᵀ · t + a · p
```

where:
- `Cᵀ` is the transposed local-trust matrix (trust flowing *into* each node),
- `a = 0.15` is the **teleport / damping** constant,
- `p` is the **prior** — uniform over all rated agents.

Iterate to convergence (~50 iterations, until the L1 change `Δ < 1e-9`). The graph is
tiny (~4.1k mainnet edges), so this converges in-memory in sub-second time.

**Why it resists gaming.** A Sybil swarm of fake clients all endorsing a fake agent earns
**~zero rank**: none of those fake wallets receives trust from a legitimate source, so
their endorsements carry almost no weight in the flow. To move the number you must be
trusted *by the already-trusted*, which is costly to fake. (The engine ships with a
Sybil unit test: 1000 fake clients with no trusted source → ~0 rank.)

---

## 2. Per-task TrustRank — "best at X"

**Plain English.** The exact same trust-flow, computed **within a single task category**
(feedback `tag1`, e.g. `solidity-audit`), so we can say "best auditor" instead of one
blurry overall number. An agent can rank #1 for audits and be unranked for RAG.

**How.** Rerun the engine on the subgraph of feedback carrying each `tag1` task category
(capped to the top ~12 categories by volume). Each agent gets a `scoresByTask[]` of
`{ tag, score, count }`.

**Where it's used.** It powers **Broker8004**'s ordering for a given request ("cheap
reliable Solidity auditor") and the **`/network`** bubble-viz clustering/coloring by
dominant task.

**Why it resists gaming.** Because each task is its own subgraph, rank earned in one
category can't leak into another — you can't pump a generic score and appear "best" at a
specialty you've never done.

---

## 3. Time-decay — keeps scores current

**Plain English.** Recent feedback matters more than old. A rating from six months ago
counts half as much as a fresh one.

**Formula.** Each feedback's weight is multiplied by

```
decay = 0.5^(ageDays / halfLife),   halfLife ≈ 180d
```

A once-great agent that's gone quiet fades; a rising agent climbs. This is the
"keep scores relevant" requirement, made precise.

**Why it resists gaming.** You can't coast on a stale reputation, and an old burst of
self-dealing feedback loses its weight over time — credibility must be continuously
re-earned.

---

## 4. Pfand-verified weighting — the moat, made mathematical

**Plain English.** Feedback backed by an on-chain **Pfand** bond — a rating that unlocked
a real deposit, tied to a real x402 payment — counts roughly `K = 3×` a plain, unbacked
feedback event.

**Why.** Anyone can emit a `NewFeedback` log for free; only a Pfand-backed rating cost
the rater a **locked deposit + a real payment** to the agent. Weighting these `×3` makes
economically-costly, payment-tied feedback **dominate** the graph — so our index is
structurally harder to fake than one scraped from public events.

**Sentiment-neutral.** A "fail" rating refunds the Pfand exactly like a "success" rating
(`RebateEscrow.claimRebate` checks only that feedback is *fresh* and non-revoked, never
its sentiment). So the boost rewards *honest, costly* feedback — not flattering feedback.

**Why it resists gaming.** Faking the dominant signal now has a real, per-rating dollar
cost (a locked bond and a settled payment), instead of being a free log emission.

---

## 5. Supporting quantities

- **satisfaction (edge value).** How a feedback maps to a trust weight: `value / 100` for
  0–100 scores; `success → 1`, `fail → 0` for binary ratings. Revoked or negative
  feedback contributes `0`.

- **distinctClients (confidence).** The count of unique raters behind a score. A high
  score from a single rater is low-confidence; EigenTrust already discounts it (one
  source can only spread a fixed total of trust), and the UI flags it.

- **trustRankRaw vs trustRank.**
  - `trustRankRaw` is the **eigenvector value** itself — tiny and skewed. It is used for
    bubble **area** in `/network` (on a sqrt scale).
  - `trustRank` (0–100) is `trustRankRaw`'s **percentile rank** among rated agents, mapped
    to a readable scale (top ≈ 100, median ≈ 50). This is the number shown on badges,
    cards, and the leaderboard.

- **Unrated agents.** An agent with no feedback gets `trustRank = null` — shown as
  **"unrated"** (never `0`, which would imply a bad reputation) and **excluded** from the
  `/network` constellation.

---

## How and when scores refresh

Scores are recomputed on a schedule and persisted to our own Supabase DB; the app reads
the live DB, with the static seed as a no-credentials fallback.

- **Trigger.** Vercel Cron → token-guarded `POST /api/cron/recompute`, schedule
  `0 */3 * * *` (every ~3h).
- **Full re-scan, no watermark.** Each run re-queries BigQuery for *all*
  `Registered` / `NewFeedback` events from the two `0x8004…` registries, idempotently
  upserts into Supabase, then loads the full feedback set and runs the engine. With $1000
  of Google credits, a full re-scan each run is the simple, robust choice — there's no
  incremental state to get wrong, and a re-run can only converge to the same answer.
- **Stamp.** The UI surfaces a "scores updated &lt;relative time&gt;" stamp from
  `trustrank_updated_at`.

> **Note.** The cron actually refreshing requires GCP + Supabase credentials. The engine
> and live scoring work from the bundled seed **with no credentials** — the seed itself is
> generated by the same engine offline, so the math is identical either way.

See [`docs/architecture.md`](architecture.md) for the full pipeline diagram and the
`/network` and Broker8004 flows.
