# Pfand — Live Demo Runbook

Goal: show all three prizes (Google · Arc/Circle · ENS) in **~3 minutes**. The narrative is the
*Pfand loop*: **Discover (ENS) → Pay (Circle/Arc) → Bond (RebateEscrow) → Reclaim (feedback)**, on
top of a **34,556-agent BigQuery index (Google)**.

## Before you start (one-time setup)

- [ ] `npm install` at repo root (app + shared).
- [ ] App running: `npm run dev` → http://localhost:3000 (seed data works with **no creds**).
- [ ] Contracts compiled: `cd contracts && forge test` → **13 passing** (8 escrow + 5 ENS).
- [ ] Two browser tabs ready:
  - Tab A: the app (`/explore`, `/search`, `/demo`).
  - Tab B: Arc explorer https://testnet.arcscan.app with the three tx hashes pre-loaded.
- [ ] (ENS booth, Sunday AM) gateway live + reachable, Sepolia resolver deployed, `broker8004.eth`
  resolver pointed at it. See `SUBMISSION-CHECKLIST.md`.

---

## The 3-minute live walkthrough

### 0:00–0:30 — Hook + Google index

> "Pfand is payment-backed reputation for the on-chain agent economy. First, you have to *find* the
> agents. We index every ERC-8004 agent on Ethereum mainnet with Google BigQuery."

- Open **`/explore`**. Point at the count: **34,556 agents, 3,173 feedback signals** — live from
  `goog_blockchain_ethereum_mainnet_us.logs`, the canonical `0x8004…` registries.
- (Optional, judges' interest) flip to `indexer/sql/reputation_summary.sql` — the Sybil-resistant
  leaderboard query, or run `cd indexer && npm run bigquery:dry` to show the real parameterized SQL.

### 0:30–1:00 — Discovery + ENS

> "You search in plain English, and every agent has a verifiable ENS name."

- Open **`/search`**, type: **"solidity auditor under $1 that accepts x402"**. The hybrid
  pgvector + hard-filter RPC ranks real agents.
- Click an agent → show its **`<agent>.broker8004.eth`** name and resolved ENSIP-26 endpoints
  (`agent-endpoint[mcp|a2a|web]`). One line: *"This name resolves live via CCIP-Read — no
  transaction per agent — and ENSIP-25 proves it's bound to a real ERC-8004 registration."*

### 1:00–2:15 — The Pfand loop on Arc/Circle (the centerpiece)

> "Now my agent hires this one. The fee is paid gas-free over Circle x402. Then it posts a 10%
> refundable deposit — the Pfand — that it gets back ONLY by leaving honest on-chain feedback."

- Open **`/demo`**, hit **Run**. Watch the stepper:
  1. **Pay fee** — x402 / Circle, gas-free (USDC).
  2. **openJob** — 10% Pfand bond escrowed in `RebateEscrow`.
  3. **giveFeedback** — fresh ERC-8004 feedback posted.
  4. **claimRebate** — contract staticcalls the registry, confirms fresh+non-revoked, **returns the
     bond in full**. Toast: "Pfand returned · reputation +1".
- Switch to **Tab B** (Arcscan) and show the **real on-chain transactions** of this exact loop on
  Arc Testnet (chainId 5042002):
  - `RebateEscrow` `0x153013f66b27De74D7b5718eb44Cd273E0FCf69d`
  - openJob `0xf283441f6826e57a0488b985d6b4e2081f7db9fd22dbcd124420d04956436896`
  - giveFeedback `0x5e3ca9bae689a8522b7a30de302bf45f9d611fc780a3a902b7f81fc323cdc5bc`
  - claimRebate `0x00739fb3a8fdff0a8dff6d54825351f5cab0fff226318e0974511bba3d29ebfe`

### 2:15–3:00 — Why it matters + close

> "Because the deposit is forfeited if you don't leave feedback, every rating is tied to a real
> payment and economically costly to fake. So our index is strictly harder to game than scraped
> feedback events. Three layers, one agentId: BigQuery finds them, ENS names them, Arc + Circle
> make them pay and rate each other trustlessly."

- (Optional) `cd contracts && forge test` on screen → 13 green, call out
  `test_RevokedFeedback_DoesNotUnlock` and `test_StaleFeedback_DoesNotUnlockNewJob`.

---

## 60–90 second video script

> **[0:00]** *(screen: `/explore`, 34,556 agents)* "This is every AI agent on Ethereum, indexed with
> Google BigQuery from the canonical ERC-8004 registries — 34,556 registrations, 3,173 feedback
> signals, live."
>
> **[0:12]** *(screen: `/search`, typing)* "You search in plain English — 'solidity auditor under a
> dollar that accepts x402' — and a pgvector hybrid search ranks the real ones."
>
> **[0:24]** *(screen: agent profile, ENS name)* "Every agent has a verifiable ENS name,
> `alice.broker8004.eth`, that resolves live over CCIP-Read to its MCP and A2A endpoints — and proves
> it's a real registration. No transaction per agent."
>
> **[0:36]** *(screen: `/demo`, stepper running)* "Now my agent hires it. The fee is paid gas-free
> over Circle's x402 nanopayments. Then it posts a 10% refundable deposit — the Pfand."
>
> **[0:52]** *(screen: stepper completes; cut to Arcscan tx)* "It gets that deposit back ONLY by
> leaving honest feedback on-chain — the contract checks the ERC-8004 registry itself. No feedback,
> the deposit is forfeited. This whole loop ran live on Arc — here are the transactions."
>
> **[1:08]** *(screen: architecture diagram / forge test green)* "So every rating is bonded to a real
> payment — impossible to fake for free. BigQuery finds the agents, ENS names them, Arc and Circle
> let them pay and rate each other trustlessly. That's Pfand: payment-backed reputation."
>
> **[1:20]** *(end card: repo + three prize logos)*

## Fallback plan (if live network is flaky)

- `/demo` and `/explore` work on **seed data with no creds** — the stepper still tells the full story.
- The Arc tx hashes are already mined; Arcscan shows them regardless of local network.
- `cd agents && npm run loop:sim` narrates the full loop offline with zero network calls.
- `forge test` is fully offline and deterministic.
