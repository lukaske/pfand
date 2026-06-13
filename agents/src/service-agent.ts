import express, { type Request, type Response } from "express";
import { getAddress } from "viem";
import { optionalEnv, requireEnv, normalizePrivateKey } from "./lib/env.js";
import { makeSellerGateway } from "./lib/x402.js";
import { runAgentWork } from "./lib/claude.js";
import { PERSONAS, type AgentPersona, buildRegistration } from "./lib/personas.js";
import { privateKeyToAccount } from "viem/accounts";

/**
 * x402 SELLER — an HTTP service agent.
 *
 * Each persona route (e.g. POST /audit) is wrapped in Circle x402 middleware:
 * the call 402s until the buyer presents a gas-free Gateway-batched payment,
 * then the handler does REAL Claude-backed work and returns findings JSON.
 *
 * Env:
 *   PORT                 default 8402
 *   SERVICE_WALLET       0x address that receives x402 payments
 *                        (defaults to the address derived from PRIVATE_KEY)
 *   SERVICE_BASE_URL     public base URL for the registration card (default http://localhost:PORT)
 *   ANTHROPIC_API_KEY    enables real Claude analysis (stub otherwise)
 *   CIRCLE_API_KEY       optional; passed to the facilitator if your gateway needs auth
 *   AGENT_PERSONAS       comma list of persona keys to expose (default: all)
 */

function resolveSellerWallet(): `0x${string}` {
  const explicit = optionalEnv("SERVICE_WALLET");
  if (explicit) return getAddress(explicit);
  // Derive from the signer key so a single funded key works out of the box.
  const pk = optionalEnv("PRIVATE_KEY");
  if (pk) return privateKeyToAccount(normalizePrivateKey(pk)).address;
  throw new Error("Set SERVICE_WALLET (0x address) or PRIVATE_KEY so the seller has a payTo wallet.");
}

function selectedPersonas(): AgentPersona[] {
  const keys = optionalEnv("AGENT_PERSONAS");
  if (!keys) return Object.values(PERSONAS);
  return keys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const p = PERSONAS[k];
      if (!p) throw new Error(`Unknown persona "${k}". Known: ${Object.keys(PERSONAS).join(", ")}`);
      return p;
    });
}

export function buildServiceApp() {
  const sellerWallet = resolveSellerWallet();
  const gateway = makeSellerGateway(sellerWallet);
  const personas = selectedPersonas();
  const port = Number(optionalEnv("PORT") ?? "8402");
  const baseUrl = optionalEnv("SERVICE_BASE_URL") ?? `http://localhost:${port}`;

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Public, free: discovery / health.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, sellerWallet, personas: personas.map((p) => p.slug) });
  });

  // Public, free: the ERC-8004 registration cards (so agentURI can point here).
  app.get("/agents", (_req: Request, res: Response) => {
    res.json(personas.map((p) => buildRegistration(p, sellerWallet, baseUrl)));
  });

  for (const persona of personas) {
    app.get(`/agents/${persona.slug}`, (_req: Request, res: Response) => {
      res.json(buildRegistration(persona, sellerWallet, baseUrl));
    });

    // PAID route: x402 middleware first, then real Claude work.
    app.post(
      persona.route,
      gateway.require(`$${persona.priceUsdc}`),
      async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as { input?: string; code?: string };
        const input = body.input ?? body.code ?? "";
        if (!input) {
          res.status(400).json({ error: "Provide `input` (or `code`) with the material to analyze." });
          return;
        }
        try {
          const { live, result } = await runAgentWork(persona, input);
          const payment = (req as Request & { payment?: unknown }).payment;
          res.json({ agent: persona.slug, live, payment, result });
        } catch (err) {
          res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
        }
      },
    );
  }

  return { app, port, sellerWallet, baseUrl, personas };
}

function main() {
  // Touch required env early for a clear failure if misconfigured.
  resolveSellerWallet();
  const { app, port, sellerWallet, baseUrl, personas } = buildServiceApp();
  app.listen(port, () => {
    console.log(`\nPfand service agent listening on ${baseUrl}`);
    console.log(`  seller wallet (payTo): ${sellerWallet}`);
    console.log(`  facilitator:           ${optionalEnv("CIRCLE_GATEWAY_URL") ?? "https://gateway-api-testnet.circle.com"}`);
    for (const p of personas) {
      console.log(`  POST ${p.route}  →  ${p.name}  ($${p.priceUsdc} via x402)`);
    }
    console.log("");
  });
}

// Run only when invoked directly (so run-loop can import buildServiceApp).
if (import.meta.url === `file://${process.argv[1]}`) {
  // requireEnv referenced so unused-import lint is satisfied if checks tighten.
  void requireEnv;
  main();
}
