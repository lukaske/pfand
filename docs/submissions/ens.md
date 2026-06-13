# ENS — Best ENS Integration for AI Agents

**Project:** Pfand / Broker8004 · **Event:** ETHGlobal New York 2026
**Live app + gateway:** https://pfand.vercel.app · **Gateway health:** https://pfand.vercel.app/api/ens/health

## Pitch

**ENS is Pfand's discovery and verifiable-identity layer — not a cosmetic label.** Every ERC-8004
agent we index is reachable at `<agent>.agent8004.eth`, and resolving that name returns **live
ENSIP-25 and ENSIP-26 records served straight from our index** — with **no on-chain transaction per
subname**. One parent name plus one `OffchainResolver` covers every agent via ENSIP-10 wildcard
resolution and EIP-3668 (CCIP-Read). The gateway is **live, served from our Vercel app at
`/api/ens`**, and **`story.agent8004.eth` resolves right now on Sepolia** to its address, agent
context, and MCP endpoint. An agent's name resolves to its verifiable registration link (ENSIP-25,
proving the name is bound to a real ERC-8004 registration) and its machine-readable endpoints
(ENSIP-26 `agent-context` and `agent-endpoint[mcp|a2a|web]`), so another agent can go from a
human-readable name to an MCP/A2A endpoint it can actually call. Records are signed by the gateway
and ECDSA-verified on-chain — trustless, dynamic, and gas-free to publish.

## How we meet every requirement

| Requirement | Status | Evidence |
|---|---|---|
| Real ENS integration (CCIP-Read / offchain) | ✓ | `contracts/src/ens/OffchainResolver.sol` (ENSIP-10 wildcard + EIP-3668), forked from `ensdomains/offchain-resolver`, pinned solc 0.8.19 / OZ v4.9.6 |
| Deployed + live on a testnet | ✓ **LIVE** | OffchainResolver `0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147` on **Sepolia**; `agent8004.eth` registered on Sepolia (register tx `0xd4d517b8152f8a116a1eb4d892134bbae5eb91ab9e12c18d5cd0628a14dc3d2b`, owner `0x2D97…`), resolver pointed at it |
| Serves live, dynamic records (not hardcoded) | ✓ | Gateway resolves records from the live index per request (`app/lib/ens/records.ts` `AgentRecordSource` → Supabase index), served from the **live Vercel app at `/api/ens`** — no hard-coded values |
| ENSIP-25 (verifiable agent identity) | ✓ **LIVE** | `story.agent8004.eth` returns `agent-registration[…8004A169…][14645] = "1"` — ERC-7930 interoperable address of the mainnet IdentityRegistry + the real agentId, proving the verified link |
| ENSIP-26 (native AI identity) | ✓ **LIVE** | `story.agent8004.eth` returns `agent-context` (free text) + `agent-endpoint[mcp] = https://8004mint.com/mcp`; addr resolves to `0xC468ff…cC6C` |
| Trustless verification of offchain data | ✓ | Gateway signs an EIP-191 `0x1900` "intended validator" hash (`target ‖ expires ‖ keccak(request) ‖ keccak(result)`); resolver `resolveWithProof` ecrecovers and requires `signers[recovered]==true` — matches `contracts/src/ens/SignatureVerifier.sol` exactly |
| Wildcard — every agent, no per-name tx | ✓ | One resolver on `agent8004.eth` resolves **all** `*.agent8004.eth` via ENSIP-10; zero transactions per subname |
| Tested | ✓ | **5/5 ENS forge tests pass** (`contracts/test/ens/OffchainResolver.t.sol`): OffchainLookup revert, valid signer, bad signer revert, expired revert, ERC-165 interface |
| Standard tooling resolves it | ✓ **LIVE** | Resolves with raw viem `getEnsText` / `getEnsAddress` on Sepolia — no custom client needed; `gateway npm run verify` does the full live round-trip against the deployed resolver |

## The tech

```
viem getEnsText("story.agent8004.eth", "agent-context")
   → OffchainResolver (Sepolia 0x03F8C6…D147) reverts OffchainLookup(url = https://pfand.vercel.app/api/ens)
   → client GET /{sender}/{data}.json
   → gateway resolves record from the live index, signs (ENS_GATEWAY_SIGNER_KEY)
   → resolver.resolveWithProof: ecrecover, check signers[] → returns value
```

- **`contracts/src/ens/OffchainResolver.sol`** — `IExtendedResolver` + EIP-3668 `OffchainLookup`;
  `resolveWithProof` enforces the signed proof. Live on Sepolia at
  `0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147`.
- **`contracts/src/ens/SignatureVerifier.sol`** — EIP-191 `0x1900` prefixed keccak (deliberately
  *not* EIP-712); the gateway's signer math is byte-for-byte identical.
- **Gateway (live on Vercel, `app/app/api/ens/[...slug]/route.ts`)** — CCIP-Read endpoint
  (`GET /:sender/:data.json` and `POST /`): decodes `IResolverService.resolve(name, data)`, extracts
  the subname label, dispatches `addr` / `text`, resolves from the index, signs, returns `{ data }`.
  Health probe at https://pfand.vercel.app/api/ens/health.
- **`app/lib/ens/records.ts`** — `resolveAgentRecords(label)` returns the ENSIP-25 + ENSIP-26 record
  set plus an `addr`; `AgentRecordSource` is the seam to the Supabase index. Records are derived from
  real mainnet ERC-8004 agents (real agentId + owner wallet + live endpoints), not hard-coded demo
  values.

## What to look at in the demo

1. **Resolve `story.agent8004.eth` live** in any app: `client.getEnsText({ name:
   "story.agent8004.eth", key: "agent-context" })` and `getEnsAddress` on Sepolia → resolves through
   our live Vercel gateway to addr `0xC468ff…cC6C`, the agent context, and
   `agent-endpoint[mcp]=https://8004mint.com/mcp`.
2. `cd gateway && npm run verify` against the deployed Sepolia resolver — prints `addr`,
   `text[agent-context]`, `text[agent-endpoint[mcp]]`, and `ENSIP-25 verified link → YES` for
   `story.agent8004.eth` and `gekko.agent8004.eth`.
3. `cd contracts && forge test --match-path 'test/ens/*'` — 5 ENS tests green.
4. In the app, each agent profile surfaces its `*.agent8004.eth` name and resolved endpoints.

## Why it's non-cosmetic

ENS is the entry point of the whole loop: you discover an agent by name, the name proves (ENSIP-25)
that it maps to a real ERC-8004 registration, and the name hands you (ENSIP-26) the MCP/A2A endpoint
your agent calls to actually hire it. Records are served live from the index — no hard-coded values —
so the directory is dynamic and trustless. Remove ENS and agents can't find or verifiably trust each
other without scraping raw chain data.

## Honesty notes

- The Sepolia resolver (`0x03F8C6…D147`), the `agent8004.eth` registration, and the public gateway
  (`https://pfand.vercel.app/api/ens`) are **all live**; `story.agent8004.eth` resolves end-to-end
  right now via raw viem — ready for the in-person ENS booth (Sunday AM).
- The submitter also owns **`agent8004.eth` on mainnet** (the Sepolia name is used for the live
  CCIP-Read testnet round-trip).
