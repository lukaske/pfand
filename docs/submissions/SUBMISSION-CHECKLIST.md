# Pfand — Submission Checklist

Per-prize artifact checklist. `[x]` = done / verified · `[ ]` = todo. Owner fills the remaining `[ ]`
items (the demo video, and confirming the public repo URL).

**Live app:** https://pfand.vercel.app

## Shared (all three prizes)

- [ ] Public repo: `github.com/<owner>/pfand` — **confirm the public URL/visibility** (only remaining
  shared gap besides the video).
- [x] **Live deployment: https://pfand.vercel.app** (explorer, search, demo, ENS gateway all live).
- [x] Architecture diagram (`docs/architecture.md` — Mermaid system + sequence diagrams).
- [x] Top-level README with concept, loop, prize mapping, verified facts (`README.md`).
- [x] Contracts tested: **13 forge tests pass** (8 RebateEscrow + 5 ENS).
- [ ] Demo video recorded (60–90s; script in `DEMO.md`) and uploaded.
- [ ] ETHGlobal project page created; description + tracks + repo + live URL + video links added.
- [ ] Team members listed on the ETHGlobal submission.

## Google Cloud — Best On-Chain Agent Economy Application

- [x] Uses BigQuery on `goog_blockchain_ethereum_mainnet_us.logs` (`indexer/src/bigquery.ts`).
- [x] Targets canonical registries: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
  Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
- [x] Live verified data: **44,974 registrations · 4,120 feedback signals**.
- [x] Reference SQL aligned to the prize gist (`indexer/sql/*.sql`); topic0 hashes match.
- [x] **Application surface LIVE: https://pfand.vercel.app/explore** — Next.js explorer + hybrid NL
  search, 52 real indexed agents.
- [x] Honest ValidationRegistry note (none on mainnet).
- [x] Frontend deployed live (Next.js on **Vercel**; Cloud-Run-deployable too) — live URL for judges.
- [ ] (Nice-to-have) Run the real `npm run bigquery` ingest with GCP creds to refresh live mainnet
  rows. Service-account JSON present at repo root (`pfand-ethglobal-*.json`).

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
- [x] **Live x402 gas-free settlement:** real Circle transfer `54719e77-8989-46c0-8ec0-a617e0e8414c`,
  0.05 USDC, `eip155:5042002`, status `received`, no buyer gas. `cd agents && npm run loop` fires it
  end-to-end.
- [x] `RebateEscrow` advanced stablecoin logic (bond-only, registry-gated release) — 8/8 tests.
- [ ] (Secondary track "Best Smart Contracts on Arc with Advanced Stablecoin Logic") — submit
  `RebateEscrow` here too if dual submission is allowed; same addresses/tx evidence.

## ENS — Best ENS Integration for AI Agents

- [x] `OffchainResolver` (ENSIP-10 wildcard + EIP-3668) + `SignatureVerifier` (`contracts/src/ens/`).
- [x] CCIP-Read gateway serving ENSIP-25 + ENSIP-26 records — **live at
  https://pfand.vercel.app/api/ens** (health: `/api/ens/health`).
- [x] 5/5 ENS forge tests pass (`contracts/test/ens/OffchainResolver.t.sol`).
- [x] **OffchainResolver deployed live on Sepolia: `0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147`.**
- [x] **`agent8004.eth` registered on Sepolia** (register tx
  `0xd4d517b8152f8a116a1eb4d892134bbae5eb91ab9e12c18d5cd0628a14dc3d2b`, owner `0x2D97…`) and resolver
  pointed at the OffchainResolver.
- [x] Gateway signer set; signer address == resolver's `SIGNER_ADDRESS` (verified via live round-trip).
- [x] Gateway exposed at a **public URL** (https://pfand.vercel.app/api/ens) for the live round-trip.
- [x] **`story.agent8004.eth` resolves LIVE** → addr `0xC468ff…cC6C`, `agent-context`,
  `agent-endpoint[mcp]=https://8004mint.com/mcp`, ENSIP-25 `agent-registration[…8004A169…][14645]="1"`.
- [x] `cd gateway && npm run verify` confirms `addr`, `agent-context`, `agent-endpoint[mcp]`,
  `ENSIP-25 verified link → YES`.
- [ ] **In-person ENS booth, Sunday AM** — be present, demo the live `*.agent8004.eth` resolution via
  raw viem on a judge's machine (everything is already live).
- [ ] (Optional) Confirm `AgentRecordSource` is wired to the Supabase index in prod (the seam is in
  place; records are derived from real mainnet agents, not hard-coded).

## Known factual notes for the writeups (keep honest)

- Test counts: **8 RebateEscrow + 5 ENS = 13 total** (any "14" reference is stale — actual is 13).
- 44,974 / 4,120 are live BigQuery counts at submission time; they grow with mainnet. The live
  explorer surfaces 52 real indexed agents.
- Mainnet reputation = aggregated real `NewFeedback` events; the *bonded* Pfand guarantee is live on
  Arc Testnet, not mainnet.
- No mainnet ValidationRegistry (spec under TEE discussion) — stated, not faked.
- ENS parent name is **`agent8004.eth`** (Sepolia, live). The submitter also owns `agent8004.eth` on
  mainnet.
