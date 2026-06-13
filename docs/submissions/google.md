# Google Cloud — Best On-Chain Agent Economy Application

**Project:** Pfand / Broker8004 · **Event:** ETHGlobal New York 2026

## Pitch

The on-chain agent economy is invisible until someone indexes it. **Pfand turns the canonical
ERC-8004 registries on Ethereum mainnet into a searchable, rankable, trustworthy directory using
Google BigQuery.** We query the public `goog_blockchain_ethereum_mainnet_us.logs` dataset for the
exact Ethereum-Foundation registry singletons (`0x8004…`), decode every `Registered` and
`NewFeedback` event, fetch each agent's off-chain card, aggregate Sybil-resistant reputation, and
serve it through a Next.js explorer with natural-language hybrid search. Live, against real mainnet
data, this indexes **34,556 agent registrations and 3,173 feedback signals** today — and because our
trust scores are bonded by an on-chain deposit (the *Pfand*), the index we build is strictly harder
to game than one scraped from permissionless events.

## How we meet every requirement

| Requirement | Status | Evidence |
|---|---|---|
| Uses Google BigQuery on real on-chain data | ✓ | `indexer/src/bigquery.ts` queries `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`; parameterized SQL in `indexer/sql/*.sql` |
| Targets the canonical ERC-8004 registries | ✓ | IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (`ERC8004_MAINNET` in `packages/shared/src/addresses.ts`) |
| Real, verified data volume | ✓ | **34,556 registrations · 3,173 feedback signals** counted live from BigQuery |
| Decodes events correctly (provable) | ✓ | `bigquery.ts` derives topic0 via viem `toEventSelector` and they equal the prize gist's hardcoded hashes — `Registered` `0xca52…bc4a`, `NewFeedback` `0x6a4a…febc` (`indexer/README.md`) |
| Aligns to the prize's reference resources | ✓ | Reproduces the four queries from the ERC-8004 BigQuery Workshop gist (registrations, feedback, Sybil-resistant leaderboard ≥3 clients, identity×reputation x402 decode) in `indexer/sql/` |
| Produces an *application*, not just a query | ✓ | Next.js 16 explorer: leaderboard, agent profiles, activity heatmaps, trend charts, x402 flags, NL hybrid search (`app/app/explore`, `app/app/search`, `app/app/agent`) |
| Cloud-deployable on Google Cloud | ✓ | Next.js app is Cloud Run–deployable; indexer is a Node job; service-account JSON wired via `GOOGLE_APPLICATION_CREDENTIALS` |
| Honest about spec gaps | ✓ | **No ValidationRegistry on mainnet** — that portion of ERC-8004 is still under active TEE-community discussion. We state this rather than fake it (a Sepolia reference impl exists at `0xC26171A3c4e1d958cEA196A5e84B7418C58DCA2C`). |

## The tech

- **Ingestion** — `indexer/src/bigquery.ts`: partition-pruned (`block_timestamp` ≥ launch
  `2026-01-28`), `topics[SAFE_OFFSET(0)]` topic-filtered queries → decode → fetch agent cards →
  aggregate reputation → idempotent upsert into Supabase (conflict key `(network, agent_id)`).
- **Search** — Supabase Postgres + **pgvector** + `pg_trgm`. The `search_agents(filters, query_embedding,
  match_count)` RPC applies hard filters (skills ⊇, max price, min score, requires-x402, network)
  first, then orders survivors by cosine distance — falling back to reputation when no embedding is
  given. Default embedder is an offline deterministic hashed bag-of-words (zero cost, no key), so
  search works the instant the schema is applied.
- **Analytics SQL** — `indexer/sql/`: `registrations.sql`, `feedback.sql`,
  `reputation_summary.sql` (Sybil-resistant leaderboard, ≥3 distinct clients),
  `activity_heatmap.sql`, `x402_join.sql` (on-chain base64 x402-capability decode).
- **App** — Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · TanStack Query.

## What to look at in the demo

1. `indexer/sql/reputation_summary.sql` — the exact Sybil-resistant leaderboard query, run against
   `goog_blockchain_ethereum_mainnet_us.logs`.
2. `npm run bigquery:dry` in `indexer/` — prints every parameterized BigQuery query with no creds.
3. The **Explore** page (`/explore`) — the 34,556 indexed agents, sortable by bonded reputation.
4. The **Search** page (`/search`) — type "solidity auditor under $1, accepts x402" in English and
   watch the hybrid filter+vector RPC rank real agents.

## Honesty notes

- The 34,556 / 3,173 figures are live BigQuery counts at submission time; they grow as mainnet does.
- Reputation scores shown for mainnet agents are aggregated from real `NewFeedback` events; the
  *bonded* trust guarantee (the Pfand loop) is live on Arc Testnet (see `arc.md`), not mainnet.
