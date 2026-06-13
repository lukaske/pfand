# Pfand — Submission Checklist

Per-prize artifact checklist. `[x]` = done / verified · `[ ]` = todo. Owner fills the `[ ]` items
(esp. anything needing live faucet funding, a public URL, or in-person presence).

## Shared (all three prizes)

- [x] Public repo: `github.com/<owner>/pfand` (this repo) — **confirm the public URL/visibility**.
- [x] Architecture diagram (`docs/architecture.md` — Mermaid system + sequence diagrams).
- [x] Top-level README with concept, loop, prize mapping, verified facts (`README.md`).
- [x] Contracts tested: **13 forge tests pass** (8 RebateEscrow + 5 ENS).
- [ ] Demo video recorded (60–90s; script in `DEMO.md`) and uploaded.
- [ ] ETHGlobal project page created; description + tracks + repo + video links added.
- [ ] Team members listed on the ETHGlobal submission.

## Google Cloud — Best On-Chain Agent Economy Application

- [x] Uses BigQuery on `goog_blockchain_ethereum_mainnet_us.logs` (`indexer/src/bigquery.ts`).
- [x] Targets canonical registries: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
  Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
- [x] Live verified data: **34,556 registrations · 3,173 feedback signals**.
- [x] Reference SQL aligned to the prize gist (`indexer/sql/*.sql`); topic0 hashes match.
- [x] Application surface: Next.js explorer + hybrid NL search (`app/`).
- [x] Honest ValidationRegistry note (none on mainnet).
- [ ] Deploy the Next.js app to **Cloud Run** (or have the deploy command ready) — live URL for judges.
- [ ] (Nice-to-have) Run the real `npm run bigquery` ingest with GCP creds so the explorer shows live
  mainnet rows, not seed data. Service-account JSON present at repo root (`pfand-ethglobal-*.json`).

## Arc / Circle — Best Agentic Economy with Circle Agent Stack (primary)

- [x] ERC-8004 registries + `RebateEscrow` deployed **live on Arc Testnet (chainId 5042002)**:
  - Identity `0xbE97d9fA39Fa62FC4d8165D1F3d6D8ef6eEDd54c`
  - Reputation `0x3A158775BB1D1F5f823712327fBBD3d977FA9A9d`
  - Validation `0xC4AD2C3FD6356f16d27f256089451B2599951f24`
  - **RebateEscrow `0x153013f66b27De74D7b5718eb44Cd273E0FCf69d`**
- [x] On-chain loop ran live (explorer https://testnet.arcscan.app):
  - openJob `0xf283441f6826e57a0488b985d6b4e2081f7db9fd22dbcd124420d04956436896`
  - giveFeedback `0x5e3ca9bae689a8522b7a30de302bf45f9d611fc780a3a902b7f81fc323cdc5bc`
  - claimRebate `0x00739fb3a8fdff0a8dff6d54825351f5cab0fff226318e0974511bba3d29ebfe`
- [x] Circle Agent Stack payments implemented: `@circle-fin/x402-batching` v3 (`agents/src/lib/x402.ts`).
- [x] `RebateEscrow` advanced stablecoin logic (bond-only, registry-gated release) — 8/8 tests.
- [ ] **Live x402 settlement:** fund the demo key with testnet USDC (`faucet.circle.com`) and run
  `cd agents && npm run loop` end-to-end so the Circle settlement leg fires for real. *Until funded,
  label it "x402 leg implemented; live Circle settlement pending Gateway funding."*
- [ ] (Fallback track "Best Smart Contracts on Arc with Advanced Stablecoin Logic) — submit
  `RebateEscrow` here too if the track allows dual submission; same addresses/tx evidence.

## ENS — Best ENS Integration for AI Agents

- [x] `OffchainResolver` (ENSIP-10 wildcard + EIP-3668) + `SignatureVerifier`
  (`contracts/src/ens/`).
- [x] CCIP-Read gateway serving ENSIP-25 + ENSIP-26 records (`gateway/src/server.ts`, `records.ts`).
- [x] 5/5 ENS forge tests pass (`contracts/test/ens/OffchainResolver.t.sol`).
- [ ] Deploy `OffchainResolver` to **Sepolia** (`forge script script/DeployResolver.s.sol`) — note
  the address.
- [ ] Generate gateway signer (`cast wallet new`), set `ENS_GATEWAY_SIGNER_KEY`; signer address ==
  resolver's `SIGNER_ADDRESS`.
- [ ] Expose the gateway at a **public URL** (ngrok / fly.io / VPS) for the live round-trip.
- [ ] Register/own `broker8004.eth` on **Sepolia** and point its resolver at the deployed
  `OffchainResolver`.
- [ ] Run `cd gateway && npm run verify` → confirm `addr`, `agent-context`,
  `agent-endpoint[mcp|a2a|web]`, `ENSIP-25 verified link → YES`.
- [ ] **In-person ENS booth, Sunday AM** — be present, demo the live `*.broker8004.eth` resolution
  via raw viem on a judge's machine.
- [ ] (Optional) Wire `AgentRecordSource` to the Supabase index so records come from the live index
  rather than the seed map.

## Known factual notes for the writeups (keep honest)

- Test counts: **8 RebateEscrow + 5 ENS = 13 total** (README's "14" is stale — actual is 13).
- 34,556 / 3,173 are live BigQuery counts at submission time; they grow with mainnet.
- Mainnet reputation = aggregated real `NewFeedback` events; the *bonded* Pfand guarantee is live on
  Arc Testnet, not mainnet.
- No mainnet ValidationRegistry (spec under TEE discussion) — stated, not faked.
