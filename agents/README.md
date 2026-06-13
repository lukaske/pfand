# Pfand agents — autonomous ERC-8004 payment loop (Arc Testnet)

This package is the **autonomous agent payment loop** for Pfand: a buyer agent
that pays a seller agent for real work **gas-free via Circle x402**, then runs
the on-chain **Pfand escrow** lifecycle (deposit held → fee released → ERC-8004
feedback posted → pfand reclaimed) on **Arc Testnet** (chain id `5042002`).

## What's here

| File | Role |
| --- | --- |
| `src/service-agent.ts` | **x402 SELLER** — Express server. Each persona route (`POST /audit`, `/optimize`, `/document`) is wrapped in Circle x402 middleware, then does **real Claude-backed work** and returns findings JSON. |
| `src/client-agent.ts` | **Autonomous BUYER** — pays the service call gas-free via x402, then runs `approve → openJob → completeJob → giveFeedback → claimRebate` with viem, logging every tx hash + deposit state. |
| `src/seed-agents.ts` | Registers 3 service agents in the Arc **IdentityRegistry** (`register(agentURI)`), writing each ERC-8004 registration card to `src/registrations/`. |
| `src/run-loop.ts` | Orchestrates the full end-to-end demo with a narrated log. |
| `src/lib/*` | clients (viem), env, x402 wrappers, escrow lifecycle, Claude work, personas, logging. |

## Payment stack (Circle x402)

Uses **`@circle-fin/x402-batching` v3** (NOT the Coinbase x402 stack):

- **Seller:** `createGatewayMiddleware({ sellerAddress, networks: "eip155:5042002", facilitatorUrl })`
  → `gateway.require("$0.05")` returns Express middleware (`src/lib/x402.ts`).
- **Buyer:** `new GatewayClient({ chain: "arcTestnet", privateKey }).pay(url, { method, body })`
  signs an off-chain EIP-3009 authorization against the GatewayWallet; the Circle
  facilitator batches + settles it. The buyer pays **no gas**.
- Facilitator: `https://gateway-api-testnet.circle.com`. Arc Gateway domain = 26.

## Prerequisites (we have none of these yet)

1. A **funded Arc Testnet key** — get USDC from <https://faucet.circle.com>.
   On Arc the native gas token *is* USDC, so one funded key covers gas + payments.
2. **Deployed contract addresses** from `../contracts` (RebateEscrow, Identity-
   Registry, ReputationRegistry).
3. (For real analysis) an **`ANTHROPIC_API_KEY`**. Without it the seller returns a
   clearly-marked stub so the loop still runs.

## Setup

```bash
cd agents
npm install
cp .env.example .env   # then fill in PRIVATE_KEY + ARC_* addresses
npm run typecheck      # tsc --noEmit, should pass
```

## Run

**Dry-run (no creds, no chain) — safe right now:**

```bash
npm run loop:sim        # narrates the whole loop, makes zero network calls
```

**Full end-to-end loop (needs funded key + deployed addresses):**

```bash
npm run loop            # seller in-process → seed agents → buyer hires auditor
```

**Individual pieces:**

```bash
npm run service         # start the x402 seller (POST /audit etc.)
npm run seed            # register the 3 agents on Arc
npm run client          # buyer hires the agent in TARGET_* env (standalone)
```

Any entrypoint fails with a clear message if required env is missing, or pass
`--sim` for a dry-run that logs intended actions.

## Fallback note

If `@circle-fin/x402-batching` ever fails to resolve, the escrow lifecycle in
`src/lib/escrow.ts` is fully self-contained viem and still works; the only x402
piece is `src/lib/x402.ts`. The package's batch scheme already signs **EIP-3009
`transferWithAuthorization`** under the hood (against the GatewayWallet), so the
"gas-free authorization" mechanism is the verified Circle path — no separate
hand-rolled EIP-3009 fallback was needed.
