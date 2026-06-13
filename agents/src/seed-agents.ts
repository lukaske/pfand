import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, getAddress } from "viem";
import { identityRegistryAbi, loadArcDeployment } from "@pfand/shared";
import { getArcClients } from "./lib/clients.js";
import { env, requireEnv, optionalEnv, isSimMode } from "./lib/env.js";
import { PERSONAS, SEED_PERSONA_KEYS, buildRegistration, type AgentPersona } from "./lib/personas.js";
import { resolveSellerWalletEnv } from "./lib/x402.js";
import { log } from "./lib/log.js";

/**
 * Registers our demo service agents in the Arc IdentityRegistry via
 * `register(agentURI)` and writes each ERC-8004 registration card to disk.
 *
 * Hosting strategy (simplest): write `src/registrations/<slug>.json` files and
 * register with a data: URI by default so nothing else needs to be running. If
 * SERVICE_BASE_URL is set, we instead register the http(s) endpoint that the
 * service agent serves at GET /agents/<slug> — and the loop can hit it live.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REG_DIR = join(__dirname, "registrations");

export interface SeededAgent {
  persona: AgentPersona;
  agentId: bigint | null;
  agentURI: string;
  serviceWallet: `0x${string}`;
  registration: Record<string, unknown>;
  txHash?: string;
}

function dataUri(json: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(json)).toString("base64");
  return `data:application/json;base64,${b64}`;
}

/** Persist the registration card and return its agentURI (http if base url set, else data:). */
function persistRegistration(
  persona: AgentPersona,
  serviceWallet: `0x${string}`,
  baseUrl: string | undefined,
): { registration: Record<string, unknown>; agentURI: string } {
  const effectiveBase = baseUrl ?? "http://localhost:8402";
  const registration = buildRegistration(persona, serviceWallet, effectiveBase);

  mkdirSync(REG_DIR, { recursive: true });
  const file = join(REG_DIR, `${persona.slug}.json`);
  writeFileSync(file, JSON.stringify(registration, null, 2));
  log.detail(`wrote ${persona.slug}.json`, file);

  const agentURI = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/agents/${persona.slug}`
    : dataUri(registration);
  return { registration, agentURI };
}

function extractAgentId(
  logs: readonly { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }[],
  registry: `0x${string}`,
): bigint {
  for (const lg of logs) {
    if (lg.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: identityRegistryAbi,
        data: lg.data,
        topics: lg.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "Registered") {
        return (decoded.args as { agentId: bigint }).agentId;
      }
    } catch {
      /* skip non-matching logs */
    }
  }
  throw new Error("Registered event not found in receipt logs");
}

export async function seedAgents(): Promise<SeededAgent[]> {
  const baseUrl = optionalEnv("SERVICE_BASE_URL");
  const sim = isSimMode();

  // serviceWallet defaults to the signer address (single-key demo).
  const seeded: SeededAgent[] = [];

  if (sim) {
    log.sim("Dry-run: writing registration cards but NOT registering on Arc.");
    const wallet = getAddress(optionalEnv("SERVICE_WALLET") ?? "0x0000000000000000000000000000000000000001");
    for (const key of SEED_PERSONA_KEYS) {
      const persona = PERSONAS[key]!;
      const { registration, agentURI } = persistRegistration(persona, wallet, baseUrl);
      log.sim(`register(agentURI) → ${agentURI.slice(0, 64)}${agentURI.length > 64 ? "…" : ""}`);
      seeded.push({ persona, agentId: null, agentURI, serviceWallet: wallet, registration });
    }
    return seeded;
  }

  const { account, publicClient, walletClient } = getArcClients();
  const deployment = loadArcDeployment(env);
  const registry = deployment.identityRegistry;
  // Use the same distinct seller wallet as the x402 seller (NOT the buyer/signer
  // account, which would self-transfer in x402). Honors SERVICE_WALLET override.
  const serviceWallet = getAddress(resolveSellerWalletEnv());

  log.step("seed", `Registering ${SEED_PERSONA_KEYS.length} agents in IdentityRegistry ${registry}`);
  log.detail("owner / signer", account.address);
  log.detail("serviceWallet", serviceWallet);

  for (const key of SEED_PERSONA_KEYS) {
    const persona = PERSONAS[key]!;
    const { registration, agentURI } = persistRegistration(persona, serviceWallet, baseUrl);

    const hash = await walletClient.writeContract({
      address: registry,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [agentURI],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const agentId = extractAgentId(receipt.logs, registry);
    log.tx(`register ${persona.slug}`, hash);
    log.ok(`${persona.name} → agentId ${agentId}`);

    seeded.push({ persona, agentId, agentURI, serviceWallet, registration, txHash: hash });
  }

  return seeded;
}

async function main() {
  log.banner("Pfand seed agents");
  void requireEnv; // available for entrypoints that need a hard env gate
  const seeded = await seedAgents();
  console.log("\nSeeded agents:");
  for (const s of seeded) {
    console.log(`  - ${s.persona.name}: agentId=${s.agentId ?? "(sim)"} wallet=${s.serviceWallet} route=${s.persona.route}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
