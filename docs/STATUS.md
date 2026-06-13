# Pfand — Project Status (single source of truth)

> **What exists and what works right now.** Written so anyone (human or AI) with
> **no prior context** can pick up Pfand from a cold start. Last verified against the
> repo on **2026-06-13** (ETHGlobal New York 2026).
>
> If a fact here ever disagrees with the code, the code wins — re-verify and update this file.

---

## 1. What it is (one paragraph)

**Pfand** is the **trust layer for the agent economy**. ERC-8004 standardizes agent
[identity](https://eips.ethereum.org/EIPS/eip-8004) + a feedback log but **not trust**, so
the headline is **TrustRank** — an EigenTrust trust-flow over a `HUMAN`-seeded graph of
sign-only reviews + real payment edges, derived purely from chain data (see §3b). The catch
with EigenTrust is a starved graph; Pfand **enforces** a dense one. You search every on-chain
agent in natural language, your agent pays the one you pick **gas-free** (Circle x402 on Arc
Testnet), and **using the broker requires** a refundable deposit — the **Pfand**, sized at
**10% of the fee** — plus a sign review, which **mints** a costly, honest trust edge. The escrow (`RebateEscrow`) holds **only** that 10% bond (never the
fee, which moves out-of-band over x402). The bond is returned to the client **only** if
they post *fresh, non-revoked* on-chain ERC-8004 feedback about that agent, verified in a
single `staticcall`; otherwise it is forfeited to the treasury. This makes feedback
economically costly to skip and cryptographically tied to a real payment, so an index
built on these signals is strictly harder to fake than one scraped from permissionless
events. (*Pfand* is German for the deposit you pay on a bottle and reclaim when you return
it — here you reclaim it by returning honest feedback.)

Three prize targets, one codebase: **Google Cloud** (BigQuery index of mainnet ERC-8004),
**Arc / Circle** (gas-free x402 payments + the escrow loop), and **ENS** (offchain
CCIP-Read resolver serving live ENSIP-25/26 agent records).

---

## 2. Live URLs & how to access

| What | URL | Notes |
|---|---|---|
| **App (primary)** | https://pfand.vercel.app | Public. Explorer, search, agent pages, scripted demo. |
| App (alias) | https://app-theta-azure-54.vercel.app | Same deployment, original Vercel domain. |
| **ENS CCIP-Read gateway** | `https://pfand.vercel.app/api/ens` | EIP-3668 gateway. Health probe: `/api/ens/health` (returns the signer address). Endpoint shape: `GET /api/ens/{sender}/{data}.json`. |
| Local dev | `http://localhost:3000` | `npm run dev` from repo root. Seed data renders with **no** credentials. |

The deployed `app/` Next.js project **is** the ENS gateway — the resolver's `url` points at
`${origin}/api/ens/...`, so the same Vercel deployment serves both the UI and CCIP-Read.

---

## 3. Per-prize status (with on-chain evidence)

### 3a. Arc / Circle — Agentic Economy  ✅ LIVE end-to-end

**Chain:** Arc Testnet, chainId **5042002**, explorer https://testnet.arcscan.app
(native gas token is USDC; gas unit reports 18 decimals at the RPC layer but the USDC
ERC-20 interface uses 6 decimals).

**Our deployed contracts (Arc Testnet):**

| Contract | Address |
|---|---|
| IdentityRegistry | `0xbE97d9fA39Fa62FC4d8165D1F3d6D8ef6eEDd54c` |
| ReputationRegistry | `0x3A158775BB1D1F5f823712327fBBD3d977FA9A9d` |
| ValidationRegistry | `0xC4AD2C3FD6356f16d27f256089451B2599951f24` |
| **RebateEscrow** (Pfand) | `0x153013f66b27De74D7b5718eb44Cd273E0FCf69d` |
| Deployer / treasury | `0x4AEDE02c0BB911424420C50A03e26092179252aC` |

**Live Pfand loop transactions (Arc Testnet):**

| Step | Tx hash |
|---|---|
| `openJob` (post 10% bond) | `0xf283441f6826e57a0488b985d6b4e2081f7db9fd22dbcd124420d04956436896` |
| `giveFeedback` (ERC-8004) | `0x5e3ca9bae689a8522b7a30de302bf45f9d611fc780a3a902b7f81fc323cdc5bc` |
| `claimRebate` (bond returned) | `0x00739fb3a8fdff0a8dff6d54825351f5cab0fff226318e0974511bba3d29ebfe` |

**Gas-free x402 settlement (Circle):** transfer id `54719e77-8989-46c0-8ec0-a617e0e8414c`,
0.05 USDC, `0x4aede0…` → `0xaa5ed2…`, network `eip155:5042002`, status **received**. Paid
via `@circle-fin/x402-batching` v3 (Circle stack, **not** the Coinbase x402 stack); the
buyer signs an off-chain EIP-3009 authorization and pays **no gas**.

**Circle gotchas worth knowing:** on Arc testnet Circle needs **no API key**, but it does
require (a) a **Gateway USDC deposit** and (b) a **seller wallet distinct from the buyer**
(a self-transfer is rejected). Facilitator: `https://gateway-api-testnet.circle.com`. Arc
Gateway domain = 26.

### 3b. Google Cloud — Best On-Chain Agent Economy Application  ✅ data is real, index ingests on creds

**Dataset:** `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`.

**Mainnet ERC-8004 registries graded against (deterministic CREATE2 singletons):**

| Registry | Address |
|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ValidationRegistry | **none on mainnet** (spec still under TEE discussion; Sepolia ref impl at `0xC26171A3c4e1d958cEA196A5e84B7418C58DCA2C`) |

**Verified live counts (pulled from BigQuery 2026-06-13):** **44,974 registrations** and
**4,120 feedback** signals. These match `STATS` in `app/lib/seed.ts`
(`agentsIndexed: 44974`, `feedbackSignals: 4120`) and `totals` in
`indexer/scripts/real-agents.cache.json`.

**TrustRank scoring (v2 — replaces the average-score).** ERC-8004 standardizes agent
**identity** + a **feedback log**, but **not trust** (`value` is a free-form `int128` with
no enforced scale, tags are free-text, anyone rates anyone for free → a plain average is
noise; our audit: **34,561 indexed, 89% single-reviewer, 178 noisy tags**). Reputation is
now **TrustRank** — an EigenTrust / PageRank trust-flow — computed by the pure, unit-tested
engine in `packages/shared/src/trustrank.ts` (vendored at `app/lib/shared/`). The v2 graph
is **one node per agent + one global `HUMAN` oracle node** (all non-agent reviewers; Sybil-
defended by the **Pfand cost per review**, not wallet-counting). Two edge kinds flow toward
agents: **review edges = sign only** (`+`/`0`/`−`; the unenforced `value` **magnitude is
ignored**; `net<0` → **distrust flag**, not negative rank) and **payment edges** (`payer→
agent`, real USDC, `log1p(amount)`, **propagated by the payer's own trust**). Trust flows via
`t ← (1−a)·Cᵀ·t + a·p` with a **HUMAN-seeded prior**; Pfand-backed edges get `≈3×`. It is
**Sybil-resistant** (a clique with no HUMAN/payment edge earns ~0). Outputs: **`trustRank`**
(0–100, headline) + **`evidence`** (distinct reviews · payment count · volume) + **`distrust
Flag`** + tags (side metadata only). Scores refresh every ~3h via **Vercel Cron → token-
guarded `/api/cron/recompute`** (full BigQuery re-scan, no watermark) → engine → Supabase
(`trustrank`, `evidence`, `distrust_flag`, `trustrank_updated_at`); the app reads the live DB
with **seed fallback**. The cron *refreshing* is creds-gated (GCP + Supabase); the engine +
live scoring work from the bundled (engine-generated) seed with **no credentials**. Full
formulas + game-resistance: **[`docs/metrics.md`](metrics.md)**; pitch: **[`docs/pitch.md`](pitch.md)**.

**Real agents powering the explorer:** the BigQuery pull cached **1,702** real mainnet
agents (`indexer/scripts/real-agents.cache.json`); the app's bundled `MAINNET_AGENTS`
(`app/lib/seed.ts`) embeds **713** of those real agents (real `agentId` / owner / URI /
feedback; agents whose off-chain card was unreachable get a synthesized label so the UI is
never blank) plus **3** Arc demo agents = **716** total in `AGENTS`.
(*Note:* an earlier brief said "52 real agents" — that is stale; the current seed carries
713 real mainnet agents.)

**GCP project:** `pfand-ethglobal`. Service-account key lives at the repo root
(`pfand-ethglobal-9c9a72a496b3.json`) and is **gitignored**.

### 3c. ENS — Integration for AI Agents  ✅ LIVE on Sepolia

**OffchainResolver (Sepolia):** `0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147` — wildcard,
ENSIP-10 `resolve(bytes,bytes)`, EIP-3668 `OffchainLookup`, on-chain signature
verification via `resolveWithProof`.

**Registered name:** `agent8004.eth` on **Sepolia**, owner
`0x2D97E75CA697007Fc7168571951314f19Cc0631b`, register tx
`0xd4d517b8152f8a116a1eb4d892134bbae5eb91ab9e12c18d5cd0628a14dc3d2b`. Subnames
`story.agent8004.eth` and `gekko.agent8004.eth` resolve live, returning ENSIP-25
`agent-registration[<erc7930-registry>][<agentId>]` and ENSIP-26 `agent-context` +
`agent-endpoint[mcp|a2a|web]` records.

The same owner also holds **`agent8004.eth` on MAINNET**, owner
`0xBA9ed4fdf8C18141169E7012f0Fd51c5343350dD` (currently unused by the resolver; optional
mainnet wiring is a stretch goal).

> ⚠️ **Branding inconsistency to be aware of.** The deployed app UI, several seed records,
> and `gateway/src/records.ts` still display the **older** parent `agent8004.eth`
> (e.g. `audit-sol.agent8004.eth`), and `.env.example` ships `ENS_PARENT_NAME=agent8004.eth`.
> The **name actually registered and resolving on Sepolia is `agent8004.eth`** (see the
> gateway's `register-sepolia.ts` / `verify.ts`). When demoing real CCIP-Read resolution,
> use `*.agent8004.eth`. The `agent8004.eth` strings are cosmetic display labels, not a
> registered name.

**Sepolia ENS gotchas (hard-won):**
- The "classic" wrapped controller `0xFED6a969…` is **broken** on Sepolia today: its
  NameWrapper is not an authorized `controller` on the BaseRegistrar (mid-ENSv2 migration),
  so `registerAndWrapETH2LD` reverts on `onlyController`.
- The **working** controller is `TestnetV1PremigrationRegistrar`
  `0xdf60C561Ca35AD3C89D24BbA854654b1c3477078` — free, single-tx, sets our resolver
  directly in the v1 registry (no NameWrapper, no commit/reveal).
- The Sepolia **UniversalResolver** ABIs are in flux (viem 2.52 calls
  `resolveWithGateways`, which the v1 UR doesn't expose). Verify by calling the
  OffchainResolver **directly** via ENSIP-10 `resolve()` (see `gateway/src/verify.ts`,
  `npm run verify`) — version-independent and exercises the exact CCIP-Read +
  signature-verification path.

---

## 4. Repo map

Monorepo. npm workspaces are `app` + `packages/*`; the other dirs are standalone Node/
Foundry projects with their own `package.json` / `foundry.toml`.

```
contracts/        Foundry — ERC-8004 (vendored CC0 ref) + RebateEscrow + ENS resolver
agents/           Node — buyer/seller agents · Circle x402 · Claude work · live Arc loop
indexer/          Node — BigQuery + Arc listener → Supabase · schema + hybrid-search SQL
gateway/          Node — ENS CCIP-Read gateway + Sepolia register/verify scripts
app/              Next.js 16 — explorer, search, agent, demo + the live /api/ens gateway
packages/shared/  @pfand/shared — viem chains, verified addresses, ABIs, domain types
docs/             architecture.md, STATUS.md (this file), submissions/, design/
```

### `contracts/` — Foundry
- **What:** the on-chain spine. Vendored CC0 ERC-8004 reference registries + our
  `RebateEscrow` + the ENS `OffchainResolver`.
- **Key files:** `src/RebateEscrow.sol` (the Pfand bond), `src/erc8004/` (Identity/
  Reputation/Validation registries), `src/ens/` (OffchainResolver), `script/Deploy.s.sol`
  (Arc stack), `script/DeployResolver.s.sol` (Sepolia resolver),
  `test/RebateEscrow.t.sol` + `test/ens/` (**13 tests: 8 escrow + 5 ENS**).
- **Run:** `forge test --root contracts -vv` (or `npm run contracts:test` from root).
  Deploy Arc: `forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast`.
- **Env:** `PRIVATE_KEY`, `USDC_ADDRESS`, optional `TREASURY` (defaults to deployer).
- **Evidence on disk:** `contracts/broadcast/DeployResolver.s.sol/11155111/run-latest.json`
  (Sepolia resolver deploy). The Arc deploy addresses live in the root `.env`.

### `agents/` — autonomous payment loop (Node + TS)
- **What:** the live Arc loop. A buyer agent pays a seller gas-free via x402, then drives
  the escrow lifecycle `approve → openJob → completeJob → giveFeedback → claimRebate`.
- **Key files:** `src/service-agent.ts` (x402 seller, Express, Claude-backed work routes
  `/audit` `/optimize` `/document`), `src/client-agent.ts` (buyer), `src/seed-agents.ts`
  (registers service agents in the Arc IdentityRegistry), `src/run-loop.ts` (narrated
  orchestration), `src/deposit-gateway.ts` (Circle Gateway USDC deposit), `src/lib/*`.
- **Run:** `cd agents && npm install && npm run loop` (live) or `npm run loop:sim`
  (offline narrative). Requires a funded Arc key + deployed contract addresses; seller
  needs an `ANTHROPIC_API_KEY` for real work (stubs cleanly without it).
- **Env:** `PRIVATE_KEY`, Arc registry addresses, `ANTHROPIC_API_KEY`, Circle settings.

### `indexer/` — the index (Node + TS)
- **What:** two ingestion paths into one Supabase schema, plus hybrid search.
- **Key files:** `src/bigquery.ts` (mainnet ERC-8004 logs → decode → fetch cards →
  aggregate → upsert), `src/arc-listener.ts` (backfill + live-watch our Arc deployment),
  `src/embed.ts` (pgvector embeddings), `src/supabase.ts`, `sql/schema.sql` +
  `sql/*.sql` (reputation, activity heatmap, x402 join, `search_agents()` RPC),
  `scripts/pull-real-agents.ts` (+ cached `real-agents.cache.json` / `.raw.json`).
- **Run:** `cd indexer && npm install`, e.g. `npm run bigquery -- --dry-run` (prints SQL
  offline; ingests once GCP + Supabase creds are present).
- **Env:** `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, Supabase URL + keys.

### `gateway/` — ENS CCIP-Read (Node + TS)
- **What:** the reference ENS gateway and the Sepolia register/verify tooling. (In
  production the same logic is served by the app's `/api/ens` route.)
- **Key files:** `src/server.ts` (gateway), `src/records.ts` (ENSIP-25/26 record builder +
  ERC-7930 encoding), `src/register-sepolia.ts` (registers `agent8004.eth`),
  `src/verify.ts` (live end-to-end CCIP-Read verification), `src/e2e-local.ts`,
  `deploy-sepolia.md` / `.sh`.
- **Run:** `cd gateway && npm install && npm run dev`; register: `npx tsx src/register-sepolia.ts`;
  verify live: `npm run verify`.
- **Env:** `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`, `ENS_GATEWAY_SIGNER_KEY`,
  `ENS_OFFCHAIN_RESOLVER`, `ENS_PARENT_NAME`, `ENS_GATEWAY_URL`.

### `app/` — Next.js 16 frontend + live ENS gateway
- **What:** the public app. Explorer, NL search, per-agent pages, scripted Pfand demo,
  and the deployed `/api/ens` CCIP-Read endpoint.
- **Key files:** `app/page.tsx` (home), `app/explore/` (leaderboard by TrustRank),
  `app/search/` (**Broker8004** · `agent8004.eth` NL search), `app/network/`
  (**trust constellation**, d3-force), `app/agent/`, `app/demo/`,
  `app/api/{agents,search,stats,activity,network}/` (data),
  `app/api/cron/recompute/` (Vercel Cron, token-guarded full re-scan → engine → DB),
  `app/api/demo/run/` (scripted loop — **synthesized** tx hashes, not the live Arc
  receipts), `app/api/ens/[...slug]/` (gateway), `lib/seed.ts` (713 real + 3 Arc agents),
  `lib/db.ts` (live Supabase reader, seed fallback), `lib/broker.ts` + `lib/llm.ts`
  (Vertex/Gemini intent extraction, deterministic fallback), `components/trust-graph.tsx`
  (d3-force viz), `lib/ens/` (resolver), `lib/search.ts`, `lib/shared/` (**vendored copy**
  of `@pfand/shared` so the app deploys to Vercel standalone).
- **Run:** `npm run dev` (root) → `http://localhost:3000`. **No credentials needed** — the
  app renders entirely from `lib/seed.ts`.
- **Env:** optional `NEXT_PUBLIC_SUPABASE_*` (falls back to seed); `ENS_GATEWAY_SIGNER_KEY`
  / `ENS_SIGNER_ADDRESS` for the live resolver signing.

### `packages/shared/` — `@pfand/shared`
- **What:** the cross-cutting source of truth: `chains.ts` (viem `arcTestnet` def +
  `ARC_CAIP2`), `addresses.ts` (verified mainnet/Sepolia/Arc addresses + `loadArcDeployment`),
  `abis.ts`, `db.ts`, types via `index.ts`.
- **Note:** `app/lib/shared/` is a **vendored copy** of this package for the standalone
  Vercel deploy — keep the two in sync when editing addresses or ABIs.

---

## 5. The Pfand mechanic, precisely

`RebateEscrow` (`contracts/src/RebateEscrow.sol`, Solidity 0.8.19) is a
`ReentrancyGuard` escrow with constants `PFAND_BPS = 1000` (10%) and `BPS_DENOM = 10000`.
It is constructed with `(usdc, reputationRegistry, treasury)`.

**Bond-only model — the escrow never holds the fee.** The service fee is paid out-of-band,
gas-free, over x402. What the escrow holds is the *Pfand*: a deposit sized at 10% of the
fee. Lifecycle per `Job`:

1. **`openJob(...)`** — the client `approve`s the escrow for the Pfand amount, then opens a
   job recording `{client, serviceWallet, agentId, fee (context only), pfand (held),
   feedbackIndexAtOpen, feedbackDeadline, status}`. Only the 10% bond is transferred in.
   Emits `JobOpened`.
2. **`giveFeedback(...)`** — the client posts ERC-8004 feedback on the ReputationRegistry
   (a separate, real on-chain call).
3. **`claimRebate(jobId)`** — the escrow does **one `staticcall`** to the ReputationRegistry
   to check the client's last feedback index for that agent is **strictly greater** than
   `feedbackIndexAtOpen` ("fresh") **and not revoked**. If so, the bond is returned to the
   client (`RebateClaimed`); recycled/stale feedback cannot unlock a new deposit, and you
   cannot claim twice.
4. **`forfeitPfand(...)`** — if the deadline passes with no fresh feedback, the bond is sent
   to the **treasury** (`RebateForfeited`).

**Tests (13 total) prove the invariants:**
`test_OpenJob_EscrowsPfandOnly`, `test_FullPfandLoop_FeedbackUnlocksRebate`,
`test_StaleFeedback_DoesNotUnlockNewJob`, `test_RevokedFeedback_DoesNotUnlock`,
`test_Forfeit_AfterDeadlineNoFeedback`, `test_Forfeit_BlockedWhenFeedbackExists`,
`test_OnlyClientCanClaim`, `test_CannotClaimTwice` (8 escrow);
`test_ResolveRevertsWithOffchainLookup`, `test_ResolveWithProof_ValidSigner`,
`test_ResolveWithProof_BadSigner_Reverts`, `test_ResolveWithProof_Expired_Reverts`,
`test_SupportsExtendedResolverInterface` (5 ENS).

---

## 6. How to run each piece (local + live demo)

**Cold start (zero credentials):**
```bash
npm install            # root workspace
npm run dev            # http://localhost:3000 — full UI from seed data
```

**Contracts:**
```bash
npm run contracts:test                 # 13 passing (8 escrow + 5 ENS)
# deploy to Arc (needs PRIVATE_KEY + USDC_ADDRESS in .env):
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

**Live Arc x402 + Pfand loop:**
```bash
cd agents && npm install
npm run loop:sim       # offline narrated walkthrough (no creds)
npm run loop           # LIVE: needs funded Arc key, deployed addresses,
                       # a Gateway USDC deposit, and a distinct seller wallet
```

**Indexer (BigQuery → Supabase):**
```bash
cd indexer && npm install
npm run bigquery -- --dry-run          # prints SQL offline
# real ingest needs GOOGLE_CLOUD_PROJECT, GOOGLE_APPLICATION_CREDENTIALS, Supabase keys
```

**ENS gateway / Sepolia:**
```bash
cd gateway && npm install
npm run dev                            # local gateway
npx tsx src/register-sepolia.ts        # register agent8004.eth (one-time)
npm run verify                         # LIVE CCIP-Read end-to-end against Sepolia + Vercel
```

**Live hosted demo:** open https://pfand.vercel.app, run the scripted demo on the Demo
page (narrated loop with synthesized hashes), and cross-reference the **real** Arc tx
hashes in §3a on https://testnet.arcscan.app.

---

## 7. DONE vs REMAINING (honest)

**DONE / LIVE:**
- ✅ `RebateEscrow` + ERC-8004 registries deployed to Arc Testnet; full Pfand loop
  (`openJob` → `giveFeedback` → `claimRebate`) executed live with real tx hashes (§3a).
- ✅ Gas-free x402 settlement via Circle (`@circle-fin/x402-batching`) — real transfer id,
  status `received` (§3a).
- ✅ 13 Foundry tests passing.
- ✅ BigQuery pull of real mainnet ERC-8004 data (44,974 / 4,120); 713 real agents bundled
  into the app; explorer/search/agent pages live on Vercel.
- ✅ **TrustRank v2 scoring** (EigenTrust over a `HUMAN` oracle node + sign-only review
  edges + real payment edges) replaces the average-score — Sybil-resistant (a clique with no
  HUMAN/payment edge → ~0), `value` magnitude ignored, unit-tested in
  `packages/shared/src/trustrank.ts`; surfaces **one TrustRank** + **evidence** + **distrust
  flag** on badges/cards/leaderboard (tags demoted to "known for" chips). Math:
  [`docs/metrics.md`](metrics.md); pitch: [`docs/pitch.md`](pitch.md).
- ✅ **`/network`** force-directed trust constellation (d3-force) — renders the EigenTrust
  graph itself: the **`HUMAN` node**, agents, and **review + payment edges**; bubbles ∝
  TrustRank, edge opacity ∝ trust flow.
- ✅ **Broker8004** (`agent8004.eth`) NL search — Vertex/Gemini intent extraction ordered by
  TrustRank, deterministic no-key fallback (Vercel-safe); **Pfand-gated** (escrow + sign
  review to use), the mechanism that mints the graph's edges.
- ✅ **Recompute cron** (`/api/cron/recompute`, Vercel Cron `0 */3 * * *`): full BigQuery
  re-scan → engine → Supabase; app reads live DB with seed fallback. *(Refreshing is
  creds-gated; engine + live scoring run from the engine-generated seed with no creds.)*
- ✅ **Rating loop** posts `giveFeedback(value=100/0, tag1=task, tag2=outcome)`;
  `claimRebate` refunds the Pfand on *fresh* feedback **regardless of sentiment** (the engine
  reads only the **sign**, not the magnitude) — these Pfand-backed sign-review edges, plus the
  x402 **payment edge** they're tied to, get the `≈3×` weight in TrustRank.
- ✅ ENS OffchainResolver deployed on Sepolia; `agent8004.eth` registered; live subnames
  (`story`, `gekko`) resolve ENSIP-25/26 records via CCIP-Read; `/api/ens` gateway served
  from the Vercel app.
- ✅ App deployed and public (https://pfand.vercel.app).

**REMAINING / OPTIONAL:**
- ⏳ **Submission docs** — `docs/submissions/{arc,google,ens}.md`, `DEMO.md`,
  `SUBMISSION-CHECKLIST.md` (being edited concurrently; not owned by this file).
- ⏳ **Demo video** — record the hosted demo + Arcscan cross-reference.
- ⏳ **Branding cleanup** — reconcile `agent8004.eth` display strings with the registered
  `agent8004.eth` (cosmetic; see §3c warning).
- ⏳ **Live Supabase ingest** — the app currently renders from `lib/seed.ts`; wiring the
  deployed indexer → Supabase → app is creds-gated, not code-gated.
- ⏳ **Optional mainnet ENS** — the `agent8004.eth` mainnet name is owned but not yet wired
  to a resolver.
- ⏳ **`/api/demo/run`** uses synthesized tx hashes — optionally swap for the real Arc
  receipts from the agents loop.

---

## 8. Environment variables reference

All secrets live in the root **`.env`** (gitignored). Template: **`.env.example`**. Each
block is independent — drop in whichever creds you have and that prize goes live. The GCP
service-account JSON key sits at the repo root (`pfand-ethglobal-9c9a72a496b3.json`,
gitignored).

| Var | Used by | Purpose |
|---|---|---|
| `ARC_RPC_URL` | contracts, agents, indexer | Arc Testnet RPC (`https://rpc.testnet.arc.network`). |
| `PRIVATE_KEY` | contracts, agents | Deployer / buyer key. On Arc, gas = USDC, so one funded key covers gas + payments. Faucet: https://faucet.circle.com |
| `USDC_ADDRESS` / `ARC_USDC` | contracts, escrow | `0x3600000000000000000000000000000000000000` (6-dec ERC-20). |
| `TREASURY` | Deploy.s.sol | Optional; defaults to deployer. Receives forfeited bonds. |
| `ARC_IDENTITY_REGISTRY` `ARC_REPUTATION_REGISTRY` `ARC_VALIDATION_REGISTRY` `ARC_REBATE_ESCROW` | indexer, agents, app | Our deployed Arc addresses (see §3a). Filled from the deploy output. |
| `CIRCLE_API_KEY` | agents | **Not required on Arc testnet** (kept for hosted facilitator). |
| `CIRCLE_ENTITY_SECRET` / `CIRCLE_GATEWAY_URL` | agents | Programmable Wallets / facilitator (`https://gateway-api-testnet.circle.com`). |
| `ANTHROPIC_API_KEY` | agents, search | Real Claude-backed work + NL search; stubs cleanly if absent. |
| `GOOGLE_CLOUD_PROJECT` | indexer | `pfand-ethglobal`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | indexer | Path to the GCP SA key JSON at the repo root. |
| `NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` | indexer, app | The unified index. App falls back to seed data if absent. |
| `SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY` | gateway, contracts | Sepolia RPC + key for resolver deploy + name registration. |
| `ENS_GATEWAY_SIGNER_KEY` / `ENS_SIGNER_ADDRESS` | gateway, app | Signs CCIP-Read responses (verified on-chain by the resolver). |
| `ENS_OFFCHAIN_RESOLVER` | gateway | `0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147`. |
| `ENS_PARENT_NAME` | gateway | Ships as `agent8004.eth` in `.env.example`; the **registered** name is `agent8004.eth` (see §3c). |
| `ENS_GATEWAY_URL` | gateway | The CCIP-Read endpoint the resolver points at. |
| `ETHERSCAN_API_KEY` | contracts | Optional, for Sepolia verification. |

---

## 9. Known gotchas (read before demoing)

1. **ENS / `agent8004.eth` vs `agent8004.eth`.** The registered, resolving name on Sepolia
   is **`agent8004.eth`**; `agent8004.eth` strings in the app/seed/`.env.example` are
   cosmetic. Demo with `*.agent8004.eth` (e.g. `story.agent8004.eth`).
2. **ENS Sepolia controller.** The classic `0xFED6a969…` controller reverts (NameWrapper not
   authorized mid-ENSv2 migration). Use `TestnetV1PremigrationRegistrar`
   `0xdf60C561Ca35AD3C89D24BbA854654b1c3477078`.
3. **ENS Sepolia UniversalResolver in flux.** Don't rely on a UniversalResolver; verify via
   a direct ENSIP-10 `resolve()` (`gateway/src/verify.ts`, `npm run verify`).
4. **Circle x402 needs a real deposit + two wallets.** No API key required on Arc testnet,
   but you must make a **Gateway USDC deposit** first and use a **seller wallet distinct
   from the buyer** — a self-transfer is rejected.
5. **Arc USDC decimals.** Native gas reports 18 decimals at the RPC layer; the USDC ERC-20
   (token transfers, x402 amounts) uses 6 decimals. Don't mix them.
6. **BigQuery cost / dataset.** Use exactly
   `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`. Queries are billed by
   bytes scanned — the cached pull (`indexer/scripts/real-agents.cache.json`) avoids
   re-billing for the demo.
7. **No-creds mode is the default.** The Vercel app and `npm run dev` render entirely from
   `app/lib/seed.ts`; live Supabase/indexer wiring is credential-gated, not built into the
   hosted demo.
8. **Vendored shared package.** `app/lib/shared/` duplicates `packages/shared/` for the
   standalone Vercel deploy — edit both when changing addresses or ABIs.
9. **Demo route hashes are synthesized.** `/api/demo/run` generates stable fake tx hashes;
   the **real** receipts are the three Arc hashes in §3a.
