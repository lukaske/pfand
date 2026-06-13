# ENS — Best ENS Integration for AI Agents

**Project:** Pfand / Broker8004 · **Event:** ETHGlobal New York 2026

## Pitch

**ENS is Pfand's discovery and verifiable-identity layer — not a cosmetic label.** Every ERC-8004
agent we index is reachable at `<agent>.broker8004.eth`, and resolving that name returns **live
ENSIP-25 and ENSIP-26 records served straight from our index** — with **no on-chain transaction per
subname**. One parent name plus one `OffchainResolver` covers every agent via ENSIP-10 wildcard
resolution and EIP-3668 (CCIP-Read). An agent's name resolves to its verifiable registration link
(ENSIP-25, proving the name is bound to a real ERC-8004 registration) and its machine-readable
endpoints (ENSIP-26 `agent-context` and `agent-endpoint[mcp|a2a|web]`), so another agent can go from
a human-readable name to an MCP/A2A endpoint it can actually call. Records are signed by the gateway
and ECDSA-verified on-chain — trustless, dynamic, and gas-free to publish.

## How we meet every requirement

| Requirement | Status | Evidence |
|---|---|---|
| Real ENS integration (CCIP-Read / offchain) | ✓ | `contracts/src/ens/OffchainResolver.sol` (ENSIP-10 wildcard + EIP-3668), forked from `ensdomains/offchain-resolver`, pinned solc 0.8.19 / OZ v4.9.6 |
| Serves live, dynamic records (not hardcoded) | ✓ | `gateway/src/server.ts` resolves records from the index per request; `gateway/src/records.ts` is the `AgentRecordSource` seam to the Supabase index |
| ENSIP-25 (verifiable agent identity) | ✓ | text key `agent-registration[<erc7930-registry>][<agentId>]` → `1` = verified link; `<erc7930-registry>` is the ERC-7930 interoperable address of the ERC-8004 IdentityRegistry (e.g. mainnet → `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`) |
| ENSIP-26 (native AI identity) | ✓ | `agent-context` (free text) + `agent-endpoint[mcp]` / `[a2a]` / `[web]` served per agent (`gateway/src/records.ts`) |
| Trustless verification of offchain data | ✓ | Gateway signs an EIP-191 `0x1900` "intended validator" hash (`target ‖ expires ‖ keccak(request) ‖ keccak(result)`); resolver `resolveWithProof` ecrecovers and requires `signers[recovered]==true` — matches `contracts/src/ens/SignatureVerifier.sol` exactly |
| Wildcard — every agent, no per-name tx | ✓ | One resolver on `broker8004.eth` resolves **all** `*.broker8004.eth` via ENSIP-10; zero transactions per subname |
| Deployed / demoable on a testnet | ✓ | Resolver deploys to **Sepolia** via `contracts/script/DeployResolver.s.sol`; `gateway npm run verify` does the full viem round-trip |
| Tested | ✓ | **5/5 ENS forge tests pass** (`contracts/test/ens/OffchainResolver.t.sol`): OffchainLookup revert, valid signer, bad signer revert, expired revert, ERC-165 interface |
| Standard tooling resolves it | ✓ | Resolves with raw viem `getEnsText` / `getEnsAddress` on Sepolia — no custom client needed |

## The tech

```
viem getEnsText("alice.broker8004.eth", "agent-context")
   → OffchainResolver (Sepolia) reverts OffchainLookup(url = gateway)
   → client GET /{sender}/{data}.json
   → gateway resolves record from index, signs (ENS_GATEWAY_SIGNER_KEY)
   → resolver.resolveWithProof: ecrecover, check signers[] → returns value
```

- **`contracts/src/ens/OffchainResolver.sol`** — `IExtendedResolver` + EIP-3668 `OffchainLookup`;
  `resolveWithProof` enforces the signed proof.
- **`contracts/src/ens/SignatureVerifier.sol`** — EIP-191 `0x1900` prefixed keccak (deliberately
  *not* EIP-712); the gateway's signer math is byte-for-byte identical.
- **`gateway/src/server.ts`** — CCIP-Read endpoint (`GET /:sender/:data.json` and `POST /`): decodes
  `IResolverService.resolve(name, data)`, extracts the subname label, dispatches `addr` / `text`,
  resolves, signs, returns `{ data }`.
- **`gateway/src/records.ts`** — `resolveAgentRecords(label)` returns the ENSIP-25 + ENSIP-26 record
  set plus an `addr`; `AgentRecordSource` is the swap-in seam for the Supabase index.

## What to look at in the demo

1. `cd contracts && forge test --match-path 'test/ens/*'` — 5 ENS tests green.
2. `cd gateway && npm run dev` then `npm run verify` against the Sepolia resolver — prints:
   `addr`, `text[agent-context]`, `text[agent-endpoint[mcp|a2a|web]]`, and `ENSIP-25 verified link → YES`.
3. Raw viem in any app: `client.getEnsText({ name: "alice.broker8004.eth", key: "agent-context" })`
   on Sepolia resolves through our gateway live.
4. In the app, each agent profile surfaces its `*.broker8004.eth` name and resolved endpoints.

## Why it's non-cosmetic

ENS is the entry point of the whole loop: you discover an agent by name, the name proves (ENSIP-25)
that it maps to a real ERC-8004 registration, and the name hands you (ENSIP-26) the MCP/A2A endpoint
your agent calls to actually hire it. Remove ENS and agents can't find or verifiably trust each
other without scraping raw chain data.

## Honesty notes

- Records are served live from the gateway; the demo seed map in `gateway/src/records.ts` stands in
  for the Supabase index until the index source is wired (the `AgentRecordSource` seam is in place).
- Sepolia resolver + a public gateway URL must be live for the in-person ENS booth round-trip
  (Sunday AM) — see `DEMO.md` and `SUBMISSION-CHECKLIST.md`.
