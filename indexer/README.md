# Pfand Index

The **INDEX** for Pfand — indexes ERC-8004 data into Supabase and serves the
analytics + hybrid (semantic + filter) search that powers the app. Built for the
Google Cloud prize **"Best On-Chain Agent Economy Application"**.

Two ingestion paths, one schema:

1. **`src/bigquery.ts`** — pulls **Ethereum mainnet** ERC-8004 logs from the
   Google BigQuery public dataset, decodes them, fetches the off-chain agent
   cards, aggregates reputation, and upserts to Supabase.
2. **`src/arc-listener.ts`** — backfills + live-watches **our Arc Testnet**
   ERC-8004 + `RebateEscrow` deployment over viem RPC, upserting agents,
   feedback, and Pfand jobs.

Search is served by the `search_agents()` Postgres RPC (pgvector + hard filters).

---

## Google prize resources (researched + aligned to)

The prize requires using the *specific Ethereum Foundation ERC-8004 reputation &
validation addresses*. We located and aligned to the exact resources the prize
links:

- **Sample BigQuery SQL Gist:**
  https://gist.github.com/godeva/040270ac2924501063d875b302cf2e91
  ("ERC-8004 BigQuery Workshop Cheat Sheet" — 4 reference queries).
- **ERC-8004 Contracts repo:** https://github.com/erc-8004/erc-8004-contracts

### Exact addresses we grade against (Ethereum mainnet)

| Registry           | Address                                      |
| ------------------ | -------------------------------------------- |
| IdentityRegistry   | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ValidationRegistry | **none on mainnet** — the Validation Registry portion of the ERC-8004 spec is still under active discussion with the TEE community. (A Sepolia reference impl exists at `0xC26171A3c4e1d958cEA196A5e84B7418C58DCA2C`, in `@pfand/shared` as `ERC8004_SEPOLIA.validationRegistry`.) |

These are deterministic CREATE2 singletons (same address across ~30 chains).
They match `ERC8004_MAINNET` in `@pfand/shared` exactly — no drift.

### Exact event topic0 hashes (from the gist; we recompute them with viem)

| Event       | topic0                                                               |
| ----------- | -------------------------------------------------------------------- |
| Registered  | `0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a` |
| NewFeedback | `0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc` |

`src/bigquery.ts` derives these from the `@pfand/shared` ABI signatures via
viem's `toEventSelector` and they equal the gist's hardcoded values, proving the
ABIs and the prize's grading agree.

### Dataset

The gist (and this indexer) use
**`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`** with
`topics[SAFE_OFFSET(0)]` filtering and partition pruning on `block_timestamp`
from the launch date `2026-01-28`. The four gist queries are reproduced (and
extended) in `sql/`:

- `registrations.sql`   — Query 1/2 (adoption curve + Registered decode)
- `feedback.sql`        — raw NewFeedback rows
- `reputation_summary.sql` — Query 3 (Sybil-resistant leaderboard, ≥3 clients)
- `activity_heatmap.sql`   — daily registrations + feedback
- `x402_join.sql`       — Query 4 (identity × reputation, on-chain base64 x402 decode)

---

## Schema & embedding

`sql/schema.sql` creates `agents`, `feedback`, `jobs`, `activity`, the `vector`
+ `pg_trgm` extensions, indexes, and the `search_agents()` RPC. Tables mirror the
canonical domain types in `packages/shared/src/db.ts`.

- **Embedding dimension: `256`** — set in `sql/schema.sql` (`vector(256)`) and
  `src/embed.ts` (`EMBED_DIM`). They MUST stay in lockstep.
- The default embedder is an **offline, deterministic hashed bag-of-words**
  (zero cost, no API key) so hybrid search works immediately. Swap in a real
  model by implementing a provider branch in `src/embed.ts` and updating both the
  dimension and the `vector(N)` column (see the TODO there).

`search_agents(filters jsonb, query_embedding vector, match_count int)` applies
hard filters (skills ⊇, maxPriceUsdc, minScore, requiresX402, payableOnly,
network) first, then orders survivors by cosine distance to the query embedding
(falling back to reputation when no embedding is given).

---

## Setup

```bash
cd indexer
npm install
cp .env.example .env   # fill in creds (none needed for dry runs)
```

Apply the schema to Supabase (either path):

- **SQL editor:** paste `sql/schema.sql` into the Supabase dashboard SQL editor and run.
- **psql:** `psql "$SUPABASE_DB_URL" -f sql/schema.sql`

After the first bulk load, run `analyze agents;` so the `ivfflat` index is usable.

---

## Run order (once creds land)

```bash
# 0. Verify type-cleanliness and preview the exact SQL with no creds:
npx tsc --noEmit
npm run bigquery:dry                 # prints every parameterized BigQuery query
npx tsx src/arc-listener.ts --dry-run

# 1. Apply the schema to Supabase (see Setup above).

# 2. Index mainnet ERC-8004 via BigQuery (needs GOOGLE_* + SUPABASE_* env):
npm run bigquery                     # registrations -> agents, feedback, activity

# 3. Index our Arc deployment (needs ARC_* + SUPABASE_* env):
npx tsx src/arc-listener.ts --once   # backfill only
npm run arc                          # backfill + live-watch (long-running)

# 4. In Supabase: analyze agents;   (refresh the ANN index after bulk load)
```

All upserts are idempotent (conflict keys: `agents`=(network,agent_id),
`feedback`=(network,agent_id,client,feedback_index), `jobs`=job_id,
`activity`=(network,day)), so steps 2–3 can be re-run safely.

---

## Environment

See `.env.example`. The indexer fails fast with a clear message when a required
variable is missing; `--dry-run` needs nothing.

| Var | Used by |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | bigquery.ts |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | both |
| `ARC_RPC_URL`, `ARC_IDENTITY_REGISTRY`, `ARC_REPUTATION_REGISTRY`, `ARC_REBATE_ESCROW`, `ARC_VALIDATION_REGISTRY`, `ARC_FROM_BLOCK` | arc-listener.ts |
| `PFAND_EMBED_PROVIDER` (default `deterministic`), `BQ_SINCE`, `IPFS_GATEWAY` | optional |
