# Pfand — Architecture

Pfand runs across **two chains** that feed **one unified index**, surfaced by **one Next.js app**.
The ERC-8004 `agentId` is the join key tying payments (Arc), analytics (Google/BigQuery), and
naming (ENS) together.

- **Ethereum mainnet** is *read-only*: we index the canonical ERC-8004 registries via BigQuery.
- **Arc Testnet** is *transactional*: our own ERC-8004 registries + `RebateEscrow` run the live
  payment-backed-reputation loop with gas-free Circle nanopayments.
- **Supabase (Postgres + pgvector)** is the single index powering the API, NL search, and the ENS
  CCIP-Read gateway.

## System diagram

```mermaid
flowchart TB
    subgraph MAINNET["Ethereum Mainnet (read-only)"]
        ID8004["ERC-8004 IdentityRegistry<br/>0x8004A1…a432"]
        REP8004["ERC-8004 ReputationRegistry<br/>0x8004BA…9b63"]
    end

    subgraph GCP["Google Cloud"]
        BQ["BigQuery<br/>goog_blockchain_ethereum_mainnet_us.logs"]
    end

    subgraph ARC["Arc Testnet (chainId 5042002)"]
        AID["IdentityRegistry"]
        AREP["ReputationRegistry"]
        ESCROW["RebateEscrow (Pfand)"]
        GATEWAYW["Circle GatewayWallet<br/>nanopayments / x402"]
    end

    subgraph AGENTS["Autonomous Agents (Node + Claude)"]
        CLIENT["client-agent<br/>(buyer)"]
        SERVICE["service-agent<br/>(x402 seller)"]
    end

    subgraph INDEX["Index"]
        INGEST["indexer<br/>bigquery.ts + arc-listener.ts"]
        SUPA[("Supabase<br/>agents · feedback · jobs<br/>+ pgvector")]
    end

    subgraph ENS["ENS (Sepolia)"]
        RESOLVER["OffchainResolver<br/>(ENSIP-10 + EIP-3668)"]
        ENSGW["CCIP-Read Gateway<br/>ENSIP-25/26 records"]
    end

    subgraph APP["Next.js app"]
        API["/api routes + React Query"]
        UI["Explore · Search · Agent · Demo"]
    end

    ID8004 --> BQ
    REP8004 --> BQ
    BQ --> INGEST
    AID --> INGEST
    AREP --> INGEST
    ESCROW --> INGEST
    INGEST --> SUPA

    CLIENT -- "x402 pay fee (gas-free)" --> GATEWAYW
    GATEWAYW -- settle --> SERVICE
    CLIENT -- "openJob (bond) / claimRebate" --> ESCROW
    CLIENT -- "giveFeedback" --> AREP
    SERVICE -- "Claude-backed work" --> CLIENT

    SUPA --> API
    SUPA --> ENSGW
    ENSGW <-- "OffchainLookup" --> RESOLVER
    API --> UI
    RESOLVER -. "*.broker8004.eth" .-> UI
```

## The Pfand loop (sequence)

```mermaid
sequenceDiagram
    participant C as Client Agent
    participant G as Circle Gateway
    participant S as Service Agent
    participant E as RebateEscrow
    participant R as ReputationRegistry
    participant I as Index → UI

    C->>G: x402 pay fee for the work (gas-free)
    G-->>S: batched settlement (USDC)
    S->>S: real Claude-backed work (e.g. Solidity audit)
    S-->>C: result
    C->>E: approve(pfand) + openJob(agentId, fee, window)
    Note over E: escrows ONLY the 10% Pfand bond
    C->>R: giveFeedback(agentId, score, …)
    C->>E: claimRebate(jobId)
    E->>R: getLastIndex(agentId, client) > snapshot && !revoked
    E-->>C: return Pfand  ✅
    R-->>I: NewFeedback event indexed → score + ENS record update
```

If the client never posts feedback before the deadline, `forfeitPfand` sends the deposit to the
treasury. Feedback is therefore economically costly to skip and cryptographically tied to a real
payment — the property that makes this index harder to fake than scraped feedback events.

## Why each prize is satisfied

| Prize | Component | Evidence |
|---|---|---|
| **Google Cloud** | `indexer/` (BigQuery) + `app/` explorer | Queries the exact mainnet registries (`0x8004…`) from `goog_blockchain_ethereum_mainnet_us.logs`; reputation scores, trends, activity heatmaps, x402 flags, NL search. |
| **Arc / Circle** | `agents/` + `contracts/RebateEscrow.sol` | Agents pay each other gas-free via `@circle-fin/x402-batching` on Arc; `RebateEscrow` is conditional escrow with automatic on-chain-verified release. |
| **ENS** | `gateway/` + `contracts/src/ens/` | Offchain CCIP-Read resolver serving live ENSIP-25 (`agent-registration`) + ENSIP-26 (`agent-context`, `agent-endpoint`) records from the index — non-cosmetic, no hard-coded values. |

## Repository layout

```
contracts/   Foundry — ERC-8004 (vendored) + RebateEscrow + ENS OffchainResolver  (14 tests)
agents/      Node — client/service agents, Circle x402 nanopayments, Claude work
indexer/     Node — BigQuery + Arc listener → Supabase; schema + hybrid-search SQL
gateway/     Node — ENS CCIP-Read gateway (ENSIP-25/26)
app/         Next.js 16 + shadcn + React Query — explorer, search, agent, demo
packages/shared/  viem chains, addresses, ABIs, shared domain types
```
