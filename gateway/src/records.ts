/**
 * Pfand ENS record resolution for <agent>.agent8004.eth.
 *
 * Produces ENSIP-25 (verifiable agent identity) and ENSIP-26 (native AI identity)
 * text records plus an address for a given subname label.
 *
 * For the hackathon demo this reads from a local seed map. The `AgentRecordSource`
 * interface is the seam where this is later swapped for our Supabase / index query.
 */

import { getAddress, type Address } from "viem";
import { ERC8004_MAINNET } from "@pfand/shared";

/** Resolved record set for one agent subname. */
export interface AgentRecords {
  /** addr(node) -> coin-type 60 (ETH) address. null => zero address. */
  addr: Address | null;
  /**
   * text(node, key) -> value. Keys include:
   *  - ENSIP-25: `agent-registration[<erc7930-registry>][<agentId>]`
   *  - ENSIP-26: `agent-context`, `agent-endpoint[mcp]`, `agent-endpoint[a2a]`, `agent-endpoint[web]`
   */
  text: Record<string, string>;
}

/** Pluggable source so the seed map can later become a Supabase/index query. */
export interface AgentRecordSource {
  resolve(label: string): Promise<AgentRecords | null>;
}

/**
 * Build the ENSIP-25 text-record KEY for a verifiable agent registration.
 *
 * The key is `agent-registration[<registry>][<agentId>]` where `<registry>` is the
 * ERC-7930 *interoperable address* of the ERC-8004 IdentityRegistry. For an Ethereum
 * mainnet (eip155, chain id 1) 20-byte address the ERC-7930 binary encoding is:
 *
 *   0x0001            version (2 bytes)
 *   0000             chain-type: 0x0000 = eip155 (2 bytes)
 *   01               chain-reference length = 1 byte
 *   01               chain reference = 0x01 (mainnet)
 *   14               address length = 0x14 = 20 bytes
 *   <20-byte addr>   the registry address
 *
 * => 0x000100000101 14 <addr> . This matches the ENSIP-25 canonical example for
 * registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.
 */
export function erc7930Mainnet(address: Address): `0x${string}` {
  const addr = getAddress(address).slice(2).toLowerCase();
  // version(0001) + chainType eip155(0000) + refLen(01) + ref mainnet(01) + addrLen(14) + addr
  return (`0x00010000010114` + addr) as `0x${string}`;
}

export function agentRegistrationKey(registry7930: `0x${string}`, agentId: string | number): string {
  return `agent-registration[${registry7930}][${agentId}]`;
}

/** One seed entry describing a demo agent. */
interface SeedAgent {
  /** addr(node) -> coin-type 60 (ETH) address. The real on-chain owner/payTo wallet. */
  addr: Address;
  /** ERC-8004 IdentityRegistry agentId this subname is the verified link for. */
  agentId: number;
  /** ENSIP-26 free-text context. */
  context: string;
  /** ENSIP-26 protocol endpoints (mcp / a2a / web). */
  endpoints: Partial<Record<"mcp" | "a2a" | "web", string>>;
}

/**
 * Demo seed agents. Labels are the subname (the part before `.agent8004.eth`).
 *
 * These are REAL Ethereum-mainnet ERC-8004 agents pulled from `app/lib/seed.ts`
 * (BigQuery -> viem-decoded `Registered` / `NewFeedback` events on the canonical
 * IdentityRegistry 0x8004A169…). Real fields preserved: `agentId` (the on-chain
 * registry id), `addr` (the agent's real owner/payTo wallet), and the live
 * service endpoints from each agent's published ERC-8004 card. The ENSIP-25
 * `agent-registration[...]` key therefore points at a genuinely-resolvable
 * (registry, agentId) pair on Ethereum mainnet.
 *
 * TODO(index): replace SeedRecordSource with a SupabaseRecordSource that reads the
 * `agents` table (packages/shared Agent type: agentId, owner, payToWallet, ensName,
 * serviceEndpoint, x402Support, ...) and synthesizes these records directly.
 */
const SEED: Record<string, SeedAgent> = {
  // Story Scoring Agent — mainnet ERC-8004 #14645 (106 verified feedback, score 87).
  // Card: data:application/json (8004mint.com), MCP service published on-chain.
  story: {
    addr: "0xc468ff1b3c7043878422a272280e19f47127cc6c",
    agentId: 14645,
    context:
      "Story Scoring Agent (ERC-8004 #14645). Scores user stories (0-100); score >=60 grants " +
      "one claim of 100 Story tokens. Pay 10 USDC to claim. Backed by 8004mint.com. " +
      "106 verified on-chain feedback signals, reputation score 87/100.",
    endpoints: {
      mcp: "https://8004mint.com/mcp",
      web: "https://8004scan.app/agent/14645",
    },
  },

  // Gekko AI — mainnet ERC-8004 #13445 (83 verified feedback, score 92).
  gekko: {
    addr: "0xb73ea3f24340f3b5d70e4ca57f84b53b88aba3a7",
    agentId: 13445,
    context:
      "Gekko AI (ERC-8004 #13445). AI portfolio manager: trading strategies, DeFi yield " +
      "optimization via Morpho vaults, and real-time market intelligence on Base. " +
      "83 verified on-chain feedback signals, reputation score 92/100.",
    endpoints: {
      a2a: "https://gekkoterminal.xyz/.well-known/agent-card.json",
      web: "https://gekkoterminal.xyz",
    },
  },

  // OpenOdds.Ai — mainnet ERC-8004 #22771 (49 verified feedback, score 89).
  openodds: {
    addr: "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
    agentId: 22771,
    context:
      "OpenOdds.Ai (ERC-8004 #22771). Verifiable pre-match football odds prediction for major " +
      "European leagues: five-model consensus, xG context, on-chain commit-reveal records. " +
      "49 verified on-chain feedback signals, reputation score 89/100.",
    endpoints: {
      a2a: "https://openodds.ai/.well-known/a2a-agent-card.json",
      web: "https://openodds.ai",
    },
  },

  // Captain Dackie — mainnet ERC-8004 #9382 (47 verified feedback, score 87, x402-enabled).
  dackie: {
    addr: "0x69f65af7f5a235909d8b249541d232b596fa379a",
    agentId: 9382,
    context:
      "Captain Dackie (ERC-8004 #9382). DeFAI + x402 AI agent from Capminal. " +
      "47 verified on-chain feedback signals, reputation score 87/100. x402-payable.",
    endpoints: {
      a2a: "https://app.virtuals.io/virtuals/23397",
      web: "https://app.virtuals.io/virtuals/23397",
    },
  },

  // Ethy AI — mainnet ERC-8004 #9380 (29 verified feedback, score 84, x402-enabled).
  ethy: {
    addr: "0xe0865ffca21a8f120a80997cbbdba8c92cac5697",
    agentId: 9380,
    context:
      "Ethy AI (ERC-8004 #9380). Vibe trading agent: turns plain-language strategies into live " +
      "24/7 automations. Built on A2A, powered by x402, secured by ERC-8004 reputation. " +
      "29 verified on-chain feedback signals, reputation score 84/100. x402-payable.",
    endpoints: {
      a2a: "https://chat.ethyai.app/.well-known/a2a/agent.json",
      web: "https://ethyai.app",
    },
  },

  // `alice` / `bob` kept as stable demo aliases for the e2e/verify scripts and docs.
  // They alias the two flagship real agents above so legacy references keep resolving.
  alice: {
    addr: "0xc468ff1b3c7043878422a272280e19f47127cc6c",
    agentId: 14645,
    context:
      "Story Scoring Agent (ERC-8004 #14645), aliased as 'alice' for the Pfand demo. " +
      "106 verified on-chain feedback signals, reputation score 87/100.",
    endpoints: {
      mcp: "https://8004mint.com/mcp",
      web: "https://8004scan.app/agent/14645",
    },
  },
  bob: {
    addr: "0xb73ea3f24340f3b5d70e4ca57f84b53b88aba3a7",
    agentId: 13445,
    context:
      "Gekko AI (ERC-8004 #13445), aliased as 'bob' for the Pfand demo. " +
      "83 verified on-chain feedback signals, reputation score 92/100.",
    endpoints: {
      a2a: "https://gekkoterminal.xyz/.well-known/agent-card.json",
      web: "https://gekkoterminal.xyz",
    },
  },
};

/** The ERC-7930 interoperable address of the mainnet ERC-8004 IdentityRegistry. */
const MAINNET_REGISTRY_7930 = erc7930Mainnet(ERC8004_MAINNET.identityRegistry as Address);

/** Default seed-backed source used by the gateway. */
export class SeedRecordSource implements AgentRecordSource {
  async resolve(label: string): Promise<AgentRecords | null> {
    const agent = SEED[label.toLowerCase()];
    if (!agent) return null;

    const text: Record<string, string> = {
      // ENSIP-25: non-empty value => verified link to (registry, agentId).
      [agentRegistrationKey(MAINNET_REGISTRY_7930, agent.agentId)]: "1",
      // ENSIP-26 native AI identity.
      "agent-context": agent.context,
    };
    if (agent.endpoints.mcp) text["agent-endpoint[mcp]"] = agent.endpoints.mcp;
    if (agent.endpoints.a2a) text["agent-endpoint[a2a]"] = agent.endpoints.a2a;
    if (agent.endpoints.web) text["agent-endpoint[web]"] = agent.endpoints.web;

    return { addr: agent.addr, text };
  }
}

/** Module-level singleton source (swap for SupabaseRecordSource later). */
export const recordSource: AgentRecordSource = new SeedRecordSource();

/**
 * Resolve the records for a subname label (e.g. "alice" for alice.agent8004.eth).
 * Returns null if the agent is unknown.
 */
export async function resolveAgentRecords(label: string): Promise<AgentRecords | null> {
  return recordSource.resolve(label);
}
