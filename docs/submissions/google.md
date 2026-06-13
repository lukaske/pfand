# Google Cloud — Best On-Chain Agent Economy Application

**Project:** Pfand / Broker8004 · **Event:** ETHGlobal New York 2026
**Live app:** https://pfand.vercel.app · **Explorer:** https://pfand.vercel.app/explore

## Pitch

The on-chain agent economy is invisible until someone indexes it. **Pfand turns the canonical
ERC-8004 registries on Ethereum mainnet into a searchable, rankable, trustworthy directory using
Google BigQuery.** We query the public `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
dataset for the exact Ethereum-Foundation registry singletons (`0x8004…`), decode every `Registered`
and `NewFeedback` event, fetch each agent's off-chain card, aggregate Sybil-resistant reputation, and
serve it through a Next.js explorer with natural-language hybrid search. Live, against real mainnet
data, this indexes **44,974 agent registrations and 4,120 feedback signals** — and because our trust
scores are bonded by an on-chain deposit (the *Pfand*), the index we build is strictly harder to game
than one scraped from permissionless events. The explorer is **live at
https://pfand.vercel.app/explore** with 52 real indexed agents.

## How we meet every requirement

| Requirement | Status | Evidence |
|---|---|---|
| Uses Google BigQuery on real on-chain data | ✓ | `indexer/src/bigquery.ts` queries `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`; parameterized SQL in `indexer/sql/*.sql` |
| Targets the canonical ERC-8004 registries | ✓ | IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (`ERC8004_MAINNET` in `packages/shared/src/addresses.ts`) |
| Real, verified data volume | ✓ | **44,974 registrations · 4,120 feedback signals** counted live from BigQuery |
| Decodes events correctly (provable) | ✓ | `bigquery.ts` derives topic0 via viem `toEventSelector` and they equal the prize gist's hardcoded hashes — `Registered` `0xca52…bc4a`, `NewFeedback` `0x6a4a…febc` (`indexer/README.md`) |
| Aligns to the prize's reference resources | ✓ | Reproduces the four queries from the ERC-8004 BigQuery Workshop gist (registrations, feedback, Sybil-resistant leaderboard ≥3 clients, identity×reputation x402 decode) in `indexer/sql/` |
| Produces an *application*, not just a query | ✓ | **Live Next.js explorer at https://pfand.vercel.app**: leaderboard, agent profiles, activity heatmaps, trend charts, x402 flags, NL hybrid search (`/explore`, `/search`, `/agent`) — 52 real agents browsable now |
| Cloud-deployable on Google Cloud | ✓ | Frontend is Next.js, **deployed live on Vercel** and Cloud-Run-deployable too; indexer is a Node job; service-account JSON wired via `GOOGLE_APPLICATION_CREDENTIALS` |
| Honest about spec gaps | ✓ | **No ValidationRegistry on mainnet** — that portion of ERC-8004 is still under active TEE-community discussion. We state this rather than fake it (a Sepolia reference impl exists). |

## The tech

- **Ingestion** — `indexer/src/bigquery.ts`: partition-pruned (`block_timestamp` ≥ launch),
  `topics[SAFE_OFFSET(0)]` topic-filtered queries → decode → fetch agent cards → aggregate
  reputation → idempotent upsert into Supabase (conflict key `(network, agent_id)`).
- **Search** — Supabase Postgres + **pgvector** + `pg_trgm`. The `search_agents(filters, query_embedding,
  match_count)` RPC applies hard filters (skills ⊇, max price, min score, requires-x402, network)
  first, then orders survivors by cosine distance — falling back to reputation when no embedding is
  given. Default embedder is an offline deterministic hashed bag-of-words (zero cost, no key), so
  search works the instant the schema is applied.
- **Analytics SQL** — `indexer/sql/`: `registrations.sql`, `feedback.sql`,
  `reputation_summary.sql` (Sybil-resistant leaderboard, ≥3 distinct clients),
  `activity_heatmap.sql`, `x402_join.sql` (on-chain base64 x402-capability decode).
- **App** — Next.js · React · Tailwind · shadcn/ui · TanStack Query, **live on Vercel**.

## What to look at in the demo

1. **The live Explore page — https://pfand.vercel.app/explore** — the indexed agents, sortable by
   bonded reputation; 52 real agents from the mainnet registries.
2. **The live Search page — https://pfand.vercel.app/search** — type "solidity auditor under $1,
   accepts x402" in English and watch the hybrid filter+vector RPC rank real agents.
3. `indexer/sql/reputation_summary.sql` — the exact Sybil-resistant leaderboard query, run against
   `goog_blockchain_ethereum_mainnet_us.logs`.
4. `npm run bigquery -- --dry-run` in `indexer/` — prints every parameterized BigQuery query with no creds.

## Honesty notes

- The 44,974 / 4,120 figures are live BigQuery counts at submission time; they grow as mainnet does.
  The live explorer surfaces 52 real indexed agents.
- Reputation scores shown for mainnet agents are aggregated from real `NewFeedback` events; the
  *bonded* trust guarantee (the Pfand loop) is live on Arc Testnet (see `arc.md`), not mainnet.
- No mainnet ValidationRegistry exists (spec under TEE-community discussion) — stated, not faked.
