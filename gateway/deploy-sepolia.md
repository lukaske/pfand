# Pfand ENS — Sepolia go-live runbook

Take the ENS integration from "deployed resolver" to "a real name resolves through
CCIP-Read with a verifiable signature." This is the exact, ordered set of steps.

## What's already done

- **OffchainResolver deployed to Sepolia (chainId 11155111):**
  - Address: **`0x163aC34292d9F17B4615FfD521Bc8753865455e2`**
  - `url()` = `https://gw.pfand.xyz/{sender}/{data}.json`
  - `signers(0x2D97E75CA697007Fc7168571951314f19Cc0631b)` = `true`
  - `supportsInterface(0x9061b923)` (IExtendedResolver / ENSIP-10) = `true`
  - Deploy tx broadcast: `contracts/broadcast/DeployResolver.s.sol/11155111/run-latest.json`
- **Local end-to-end proof** of the signed CCIP-Read round-trip passes against real
  mainnet ERC-8004 agents — see `gateway/src/e2e-local.ts` (`cd gateway && npm run e2e`).
- Gateway signer key (`ENS_GATEWAY_SIGNER_KEY` == `SEPOLIA_PRIVATE_KEY`) corresponds to
  `ENS_SIGNER_ADDRESS=0x2D97E75CA697007Fc7168571951314f19Cc0631b`, which is the
  authorized signer on the deployed resolver.

> The resolver's `url` is **immutable** (no setter). If the production gateway lands at a
> different URL than `https://gw.pfand.xyz/...`, redeploy with `gateway/deploy-sepolia.sh`
> (it's cheap, ~0.0008 ETH) and use the new address everywhere below.

## Canonical Sepolia ENS addresses

| Contract | Address |
|---|---|
| ENS Registry (`ENS`) | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` (same on all chains) |
| ETHRegistrarController (.eth registrar) | `0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968` |
| Public Resolver | `0x8FADE66B79cC9f707aB26799354482EB93a5B7dD` |
| Reverse Registrar | `0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6` |
| UniversalResolver | resolved dynamically by viem on the `sepolia` chain |

(Re-confirm against https://docs.ens.domains/learn/deployments before relying on them.)

## Remaining go-live blocker: a parent name

`agent8004.eth` is currently **unowned on Sepolia** (registry `owner()` == `0x0`). To go
live you need to own a parent `.eth` name on Sepolia and point its resolver at our contract.

### Step 1 — Register a parent name on Sepolia (simplest: ENS web app)

1. Open the **Sepolia** ENS manager: <https://sepolia.app.ens.domains/>
2. Connect the wallet for `0x2D97E75CA697007Fc7168571951314f19Cc0631b` (the deployer/signer;
   it currently holds ~0.20 Sepolia ETH — enough for registration + gas).
3. Search a name (e.g. `agent8004.eth`, or any free name — call it `<PARENT>`), then
   **Register** it (two-tx commit/reveal; the UI walks you through it).
4. After registration you own `<PARENT>` on Sepolia.

> Programmatic alternative (only if you prefer CLI): the registration is a
> commit→wait(60s)→register flow on the ETHRegistrarController
> (`0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968`):
> `makeCommitment` → `commit(bytes32)` → wait ≥60s → `register{value: price}(name, owner,
> duration, secret, resolver, data[], reverseRecord, ownerControlledFuses)`.
> Get the price first with `rentPrice(string,uint256)`. The web app is more reliable
> for a one-off, so prefer it unless you're scripting many names.

### Step 2 — Point the parent name's resolver at our OffchainResolver

Set the resolver of `<PARENT>` to `0x163aC34292d9F17B4615FfD521Bc8753865455e2`.

**Via the ENS app:** open `<PARENT>` → **Edit Resolver** → "Custom resolver" →
paste `0x163aC34292d9F17B4615FfD521Bc8753865455e2` → Save (one tx).

**Via cast:**
```bash
source <(grep -E '^(SEPOLIA_RPC_URL|SEPOLIA_PRIVATE_KEY)=' .env)
PARENT_NAMEHASH=$(cast namehash <PARENT>)              # e.g. agent8004.eth
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  'setResolver(bytes32,address)' \
  "$PARENT_NAMEHASH" 0x163aC34292d9F17B4615FfD521Bc8753865455e2 \
  --rpc-url "$SEPOLIA_RPC_URL" --private-key "$SEPOLIA_PRIVATE_KEY"
```

Because our resolver implements ENSIP-10 wildcard (`resolve(bytes,bytes)` + IExtendedResolver),
**every** subname `<label>.<PARENT>` is now resolved offchain by the gateway — you do **not**
register subnames on-chain.

### Step 3 — Host the gateway at the URL baked into the resolver

The resolver points clients at `https://gw.pfand.xyz/{sender}/{data}.json`. Deploy
`gateway/src/server.ts` there (any Node host / serverless function works; it's a plain
`http` server). It needs one secret:

```
ENS_GATEWAY_SIGNER_KEY=<the key for 0x2D97E75CA697007Fc7168571951314f19Cc0631b>
```

Sanity check once live:
```bash
curl https://gw.pfand.xyz/health
# -> {"ok":true,"signer":"0x2D97E75CA697007Fc7168571951314f19Cc0631b"}
```
The `signer` returned MUST equal the authorized signer on the resolver, or every
`resolveWithProof` will revert.

### Step 4 — Set .env and prove it resolves end-to-end on Sepolia

```
ENS_OFFCHAIN_RESOLVER=0x163aC34292d9F17B4615FfD521Bc8753865455e2
ENS_PARENT_NAME=<PARENT>
ENS_GATEWAY_URL=https://gw.pfand.xyz/{sender}/{data}.json
```

Then run the CCIP-Read verifier (uses viem + the Sepolia UniversalResolver; viem performs
the offchain hop and the on-chain `resolveWithProof` signature check for you):
```bash
cd gateway
ENS_VERIFY_LABEL=story npm run verify
```
Expected: a real address + ENSIP-25 `agent-registration[...]` + ENSIP-26
`agent-context` / `agent-endpoint[...]` values for the Story Scoring Agent (mainnet
ERC-8004 #14645). Other demo labels: `gekko`, `openodds`, `dackie`, `ethy`.

## Summary checklist

- [x] OffchainResolver deployed to Sepolia → `0x163aC34292d9F17B4615FfD521Bc8753865455e2`
- [x] Authorized signer + gateway URL set on-chain (verified)
- [x] Local signed CCIP-Read round-trip proven (`npm run e2e`)
- [ ] Register a parent `.eth` name on Sepolia (`<PARENT>`)
- [ ] `setResolver(<PARENT>, 0x163aC342…)`
- [ ] Host the gateway at `https://gw.pfand.xyz/{sender}/{data}.json`
- [ ] `npm run verify` against Sepolia returns the records

## Re-deploying the resolver

If you need a fresh resolver (e.g. different gateway URL or signer):
```bash
VERIFY=1 ./gateway/deploy-sepolia.sh   # VERIFY optional; needs ETHERSCAN_API_KEY
```
The script does a balance pre-flight and refuses to broadcast if the deployer has
< 0.002 Sepolia ETH, then prints the new address and these same next steps.
