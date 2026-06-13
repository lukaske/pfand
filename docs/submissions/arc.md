# Arc / Circle — Best Agentic Economy with Circle Agent Stack

**Project:** Pfand / Broker8004 · **Event:** ETHGlobal New York 2026
**Live app:** https://pfand.vercel.app · **Demo loop:** https://pfand.vercel.app/demo
**Primary track:** Best Agentic Economy with Circle Agent Stack
**Also fits:** Best Smart Contracts on Arc with Advanced Stablecoin Logic (the conditional-escrow `RebateEscrow`)

## Pitch

**Pfand is a live agentic economy where agents hire, pay, and rate each other entirely on Arc.** A
buyer agent discovers a seller, pays the service fee **gas-free over Circle x402 nanopayments**
(`@circle-fin/x402-batching`, USDC, no native-token gas), receives real Claude-backed work, then
posts a refundable **Pfand** bond into our `RebateEscrow` contract. The bond — 10% of the fee — comes
back to the buyer **only if they leave fresh, non-revoked on-chain ERC-8004 feedback**, verified by
the contract in a single staticcall; otherwise it is forfeited. The whole loop ran **live end-to-end
on Arc Testnet (chainId 5042002)** with on-chain transactions you can open in the explorer, and the
**gas-free x402 settlement leg is live too** — a real Circle USDC transfer with zero buyer gas. This
is advanced stablecoin logic — conditional escrow whose release is gated on a separate registry's
state — sitting on top of a real Circle Agent Stack payment rail.

## How we meet every requirement

| Requirement | Status | Evidence |
|---|---|---|
| Agents transact autonomously on Arc | ✓ | `agents/src/client-agent.ts` (buyer) + `agents/src/service-agent.ts` (seller) run the full `pay → openJob → giveFeedback → claimRebate` loop |
| Uses the Circle Agent Stack for payments | ✓ | `@circle-fin/x402-batching` v3 (NOT Coinbase x402): seller `createGatewayMiddleware(...).require("$0.05")`; buyer `new GatewayClient({chain:"arcTestnet"}).pay(url,...)` — `agents/src/lib/x402.ts` |
| Gas-free stablecoin payments | ✓ **LIVE** | Buyer signs an off-chain EIP-3009 `transferWithAuthorization` against the Circle GatewayWallet; the facilitator batches + settles. **Live Circle transfer `54719e77-8989-46c0-8ec0-a617e0e8414c`, 0.05 USDC, `eip155:5042002`, status `received`, no buyer gas.** |
| Deployed on Arc | ✓ | **Live on Arc Testnet (chainId 5042002, explorer https://testnet.arcscan.app):** IdentityRegistry `0xbE97d9fA39Fa62FC4d8165D1F3d6D8ef6eEDd54c` · ReputationRegistry `0x3A158775BB1D1F5f823712327fBBD3d977FA9A9d` · ValidationRegistry `0xC4AD2C3FD6356f16d27f256089451B2599951f24` · **RebateEscrow `0x153013f66b27De74D7b5718eb44Cd273E0FCf69d`** |
| The on-chain loop actually ran (not staged) | ✓ | `openJob` `0xf283441f6826e57a0488b985d6b4e2081f7db9fd22dbcd124420d04956436896` · `giveFeedback` `0x5e3ca9bae689a8522b7a30de302bf45f9d611fc780a3a902b7f81fc323cdc5bc` · `claimRebate` `0x00739fb3a8fdff0a8dff6d54825351f5cab0fff226318e0974511bba3d29ebfe` |
| Advanced stablecoin logic in the contract | ✓ | `RebateEscrow` escrows **only** the 10% bond (fee paid via x402); release is gated on the ERC-8004 ReputationRegistry via `getLastIndex` + `readFeedback` staticcalls — "fresh" (index strictly increased) and not revoked (`contracts/src/RebateEscrow.sol`) |
| Tested | ✓ | **8/8 RebateEscrow forge tests pass** incl. stale-feedback, revoked-feedback, forfeit, double-claim, and full-loop cases (`contracts/test/RebateEscrow.t.sol`); 13 total with ENS |
| Real work, not a toy ping | ✓ | Seller does genuine Claude-backed work (Solidity audit / gas optimization / doc generation) and returns findings JSON (`agents/src/lib/` personas) |

## The tech

- **Payment rail (Circle Agent Stack).** `@circle-fin/x402-batching` v3. Seller wraps each persona
  route (`POST /audit`, `/optimize`, `/document`) in Circle gateway middleware. Buyer's
  `GatewayClient.pay()` produces a signed EIP-3009 authorization; Circle's facilitator batches and
  settles in USDC. Arc's native gas token *is* USDC, so one funded key covers everything and the
  buyer's settlement leg carries **no gas — confirmed live** (transfer `54719e77-…`, 0.05 USDC,
  `eip155:5042002`, status `received`). Arc Gateway domain = 26.
- **The bond contract.** `RebateEscrow` (Solidity 0.8.19, OZ v4.9.6, ReentrancyGuard). `openJob`
  pulls the 10% Pfand via `safeTransferFrom` and snapshots the client's feedback index. `claimRebate`
  returns the bond iff `_freshFeedbackIndex(...) > 0` — i.e. the client's last feedback index for that
  agent strictly increased since open **and** the feedback is not revoked. `forfeitPfand` sends the
  bond to the treasury after the deadline if no fresh feedback exists. The service fee never enters
  the contract — it is paid out-of-band over x402.
- **Why bond-only.** Escrowing the full fee would make the contract a payment processor and duplicate
  Circle's rail. Escrowing only the 10% Pfand makes feedback *economically costly to skip* and
  *cryptographically tied to a real payment* — the precise property that makes our reputation index
  harder to fake than scraped events.

## What to look at in the demo

1. **The live `/demo` page — https://pfand.vercel.app/demo** — stepper visualizing fee (x402,
   gas-free) → bond escrowed → feedback posted → Pfand returned, with the on-chain receipt.
2. Open the three tx hashes above on https://testnet.arcscan.app — the live `openJob → giveFeedback
   → claimRebate` sequence against `RebateEscrow 0x153013…f69d`.
3. `cd contracts && forge test` — 8 RebateEscrow tests green, including
   `test_StaleFeedback_DoesNotUnlockNewJob` and `test_RevokedFeedback_DoesNotUnlock`.
4. `cd agents && npm run loop` runs the full buyer/seller loop live against Arc with a funded key
   (the gas-free Circle settlement leg fires for real — transfer `54719e77-…`); `npm run loop:sim`
   narrates it offline with zero network calls.

## Honesty notes

- The **contract loop is fully live on-chain** (the three tx hashes are real and explorable).
- The **x402 gas-free settlement leg is live** — a real Circle USDC transfer
  (`54719e77-8989-46c0-8ec0-a617e0e8414c`, 0.05 USDC, `eip155:5042002`, status `received`) with no
  buyer gas. The escrow lifecycle in `agents/src/lib/escrow.ts` is self-contained viem and runs
  independently of the x402 leg.
