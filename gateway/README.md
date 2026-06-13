# Pfand ENS CCIP-Read Gateway

Makes `<agent>.agent8004.eth` resolve to **live** ENSIP-25/26 records served from the Pfand
index — with **no on-chain transaction per subname**. One parent name + one resolver covers
every agent via ENSIP-10 wildcard resolution and EIP-3668 (CCIP-Read).

```
viem getEnsText("alice.agent8004.eth", "agent-context")
        │
        ▼
OffchainResolver (Sepolia)  ──reverts──▶  OffchainLookup(url = this gateway)
        │                                         │
        │                              GET /{sender}/{data}.json
        ▼                                         ▼
   resolveWithProof(response)  ◀── { data } ── this gateway (signs with ENS_GATEWAY_SIGNER_KEY)
        │
        ▼  ECDSA-recover, check signers[] mapping
   record value
```

## Architecture

- `src/server.ts` — the CCIP-Read HTTP endpoint (`GET /:sender/:data.json` and `POST /`).
  Decodes `IResolverService.resolve(name, data)`, extracts the subname label from the
  DNS-encoded name, dispatches `addr` / `text`, resolves records, signs, returns `{ data }`.
- `src/records.ts` — `resolveAgentRecords(label)` returns the agent's ENSIP-25
  (`agent-registration[...]`) and ENSIP-26 (`agent-context`, `agent-endpoint[mcp|a2a|web]`)
  text records plus an `addr`. Backed by a local seed map now; `AgentRecordSource` is the
  seam to swap in a Supabase/index source (see the TODO in that file).
- `src/verify.ts` — resolves a name end-to-end via viem against a running gateway + deployed
  resolver.

## Signing scheme (must match `contracts/src/ens/SignatureVerifier.sol` exactly)

This is **not** EIP-712. It is an EIP-191 `0x1900` ("intended validator") prefixed keccak hash:

```
hash = keccak256( abi.encodePacked(
          0x1900,
          target,                 // the resolver contract address (= request `sender`)
          expires,                // uint64
          keccak256(request),     // request = the inner abi-encoded resolve(name,data) callData
          keccak256(result)       // result  = the abi-encoded record value
       ) )
sig  = ECDSA sign(hash)          // 65-byte r||s||v
response = abi.encode(bytes result, uint64 expires, bytes sig)
```

The resolver's `resolveWithProof` ecrecovers `hash` from `sig` and requires
`signers[recovered] == true`. So the gateway's `ENS_GATEWAY_SIGNER_KEY` address **must** be the
`SIGNER_ADDRESS` passed to the resolver at deploy time.

## Setup

```bash
cp .env.example .env
# edit .env: set ENS_GATEWAY_SIGNER_KEY (cast wallet new), SEPOLIA_RPC_URL
npm install
npm run typecheck      # tsc --noEmit
npm run dev            # starts on :8080, prints the signer address
```

The gateway prints the signer address on boot — that is your `SIGNER_ADDRESS`.

## End-to-end demo: `alice.agent8004.eth` on Sepolia

### 1. Generate the gateway signer
```bash
cast wallet new          # copy the private key -> ENS_GATEWAY_SIGNER_KEY in gateway/.env
                         # copy the address     -> SIGNER_ADDRESS below
```

### 2. Run the gateway (publicly reachable for the live demo)
```bash
cd gateway && npm install && npm run dev
# expose it (ngrok, fly.io, a VPS, etc). Note the public base URL, e.g.
#   https://gw.pfand.xyz
# the GATEWAY_URL template is then:  https://gw.pfand.xyz/{sender}/{data}.json
```

### 3. Deploy the resolver to Sepolia
```bash
cd ../contracts
PRIVATE_KEY=0x...                # a funded Sepolia deployer
GATEWAY_URL='https://gw.pfand.xyz/{sender}/{data}.json'
SIGNER_ADDRESS=0x...             # address of ENS_GATEWAY_SIGNER_KEY

forge script script/DeployResolver.s.sol --rpc-url sepolia --broadcast
# -> note the deployed OffchainResolver address
```

### 4. Point the parent name at the resolver
Own `agent8004.eth` on Sepolia (register at https://app.ens.domains on the Sepolia testnet),
then in the ENS Manager set its **resolver** to the deployed `OffchainResolver` address.
Because the resolver implements ENSIP-10 wildcard, **every** `*.agent8004.eth` now resolves
through the gateway — no per-subname transaction.

### 5. Resolve it
```bash
cd ../gateway
# set ENS_PARENT_NAME=agent8004.eth, ENS_VERIFY_LABEL=alice, SEPOLIA_RPC_URL in .env
npm run verify
```
Expected output:
```
addr                       -> 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
text[agent-context]        -> Pfand demo agent 'alice'. ...
text[agent-endpoint[mcp]]  -> https://alice.agents.pfand.xyz/mcp
text[agent-endpoint[a2a]]  -> https://alice.agents.pfand.xyz/.well-known/agent.json
text[agent-endpoint[web]]  -> https://pfand.xyz/agent/alice
ENSIP-25 verified link     -> YES (1)
```

Or with raw viem in any app:
```ts
import { createPublicClient, http, normalize } from "viem";
import { sepolia } from "viem/chains";
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
await client.getEnsText({ name: normalize("alice.agent8004.eth"), key: "agent-context" });
await client.getEnsAddress({ name: normalize("alice.agent8004.eth") });
```

## ENSIP-25 / ENSIP-26 records served

- **ENSIP-25** (verifiable agent identity): text key
  `agent-registration[<erc7930-registry>][<agentId>]`, value `1` = verified link.
  `<erc7930-registry>` is the ERC-7930 interoperable address of the ERC-8004 IdentityRegistry,
  e.g. mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` →
  `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`.
- **ENSIP-26** (native AI identity): `agent-context` (free text) and
  `agent-endpoint[<protocol>]` for `protocol ∈ {mcp, a2a, web}`.

## Local smoke test (no chain)

```bash
npm run dev
# health
curl localhost:8080/health
# A real {sender,data} pair is produced by the CCIP client; use `npm run verify`
# against a deployed resolver for the full round-trip.
```
