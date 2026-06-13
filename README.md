# Pfand — payment-backed reputation for ERC-8004 agents

> **App / agent name:** Broker8004 · **Event:** ETHGlobal New York 2026
> Discovery, payments & payment-backed reputation for the on-chain agent economy.

**Pfand** is a brokerage layer for [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agents. You
search every agent in natural language, your agent pays the one you pick gas-free, and trust is
guaranteed by a refundable deposit — the *Pfand* — that the escrow returns **only when you post
honest feedback on-chain**. Feedback becomes economically costly to fake and cryptographically tied
to a real payment, which makes our index strictly harder to game than one scraped from public
events.

> *Pfand* (German): the deposit you pay on a bottle and reclaim when you return it. Here, you reclaim
> it by returning honest feedback.

## The loop

```
Discover  →  Pay (x402, gas-free)  →  Deposit (10% Pfand escrowed)  →  Reclaim (post feedback → deposit returned)
   ENS          Circle · Arc                RebateEscrow                    ReputationRegistry
```

The 10% deposit is released back to the client **iff** they post *fresh, non-revoked* feedback about
the agent to the Arc ReputationRegistry — verified on-chain by `RebateEscrow` in a single
`staticcall`. No feedback before the deadline → the deposit is forfeited. See
[`docs/architecture.md`](docs/architecture.md) for diagrams.

## Prize targets

| Prize | What we built |
|---|---|
| **Google Cloud** — On-Chain Agent Economy | BigQuery index of mainnet ERC-8004 (`0x8004…`) → reputation scores, trends, activity heatmaps, x402 flags, NL search. |
| **Arc / Circle** — Agentic Economy | Autonomous agents paying each other gas-free via `@circle-fin/x402-batching`; `RebateEscrow` = conditional escrow with automatic on-chain release. |
| **ENS** — Integration for AI Agents | Offchain CCIP-Read resolver serving live ENSIP-25 + ENSIP-26 records for `<agent>.broker8004.eth` from the index. |

## Architecture in one breath

Two chains, one index. **Mainnet** is read-only (BigQuery → Supabase). **Arc Testnet** is
transactional (our ERC-8004 registries + `RebateEscrow` + Circle nanopayments). **Supabase
(Postgres + pgvector)** is the single index powering the API, hybrid NL search, and the ENS gateway.
The Next.js app surfaces all of it. The ERC-8004 `agentId` joins everything.

```
contracts/   Foundry — ERC-8004 (vendored CC0 reference) + RebateEscrow + ENS resolver  ✅ 13 tests
agents/      Node — client/service agents · Circle x402 nanopayments · Claude-backed work
indexer/     Node — BigQuery + Arc listener → Supabase · schema + hybrid-search SQL
gateway/     Node — ENS CCIP-Read gateway (ENSIP-25/26)
app/         Next.js 16 · shadcn/ui · React Query — explorer, search, agent, demo
packages/shared/  viem chains · verified addresses · ABIs · shared domain types
```

## Quickstart

```bash
npm install                      # root workspace (app + shared)
cp .env.example .env             # fill in the secrets you have; each block is independent

# Contracts
cd contracts && forge test       # 14 passing
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast   # deploy to Arc

# App (seed data works with no creds)
npm run dev                      # http://localhost:3000

# Agents (offline narrative; live once Arc creds are set)
cd agents && npm install && npm run loop:sim

# Indexer (prints SQL offline; ingests once GCP + Supabase creds are set)
cd indexer && npm install && npm run bigquery -- --dry-run

# ENS gateway
cd gateway && npm install && npm run dev
```

Each component reads its config from environment variables documented in
[`.env.example`](.env.example). The blocks are independent — drop in whichever credentials you have
(Arc key, Circle API key, GCP/BigQuery, Supabase, ENS/Sepolia) and that prize goes live end-to-end.

## Verified facts baked in

- ERC-8004 mainnet: IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
  ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (no ValidationRegistry on mainnet).
- BigQuery dataset: `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`.
- Arc Testnet: chainId `5042002`, USDC `0x3600…0000` (6-dec), GatewayWallet `0x0077…19B9`,
  Circle facilitator `https://gateway-api-testnet.circle.com`.
- ENS: ENSIP-25 `agent-registration[<registry>][<agentId>]`, ENSIP-26 `agent-context` /
  `agent-endpoint[mcp|a2a|web]`.

## Tech

Solidity 0.8.19 · Foundry · viem · Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · TanStack Query ·
Circle Agent Stack (`@circle-fin/x402-batching`) · Anthropic Claude · Google BigQuery · Supabase
(Postgres + pgvector) · ENS (EIP-3668 / ENSIP-10/25/26).
