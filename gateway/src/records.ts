/**
 * Pfand ENS record resolution for <agent>.broker8004.eth.
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
  addr: Address;
  /** ERC-8004 IdentityRegistry agentId this subname is the verified link for. */
  agentId: number;
  /** ENSIP-26 free-text context. */
  context: string;
  /** ENSIP-26 protocol endpoints (mcp / a2a / web). */
  endpoints: Partial<Record<"mcp" | "a2a" | "web", string>>;
}

/**
 * Demo seed agents. Labels are the subname (the part before `.broker8004.eth`).
 * TODO(index): replace SeedRecordSource with a SupabaseRecordSource that reads the
 * `agents` table (packages/shared Agent type: agentId, owner, payToWallet, ensName,
 * serviceEndpoint, x402Support, ...) and synthesizes these records.
 */
const SEED: Record<string, SeedAgent> = {
  alice: {
    addr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    agentId: 42,
    context:
      "Pfand demo agent 'alice'. ERC-8004 trading agent indexed by broker8004.eth. " +
      "Payment-backed reputation on Arc. Speaks MCP and A2A.",
    endpoints: {
      mcp: "https://alice.agents.pfand.xyz/mcp",
      a2a: "https://alice.agents.pfand.xyz/.well-known/agent.json",
      web: "https://pfand.xyz/agent/alice",
    },
  },
  bob: {
    addr: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    agentId: 7,
    context:
      "Pfand demo agent 'bob'. ERC-8004 research/summarization agent. x402-payable on Arc Testnet.",
    endpoints: {
      mcp: "https://bob.agents.pfand.xyz/mcp",
      web: "https://pfand.xyz/agent/bob",
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
 * Resolve the records for a subname label (e.g. "alice" for alice.broker8004.eth).
 * Returns null if the agent is unknown.
 */
export async function resolveAgentRecords(label: string): Promise<AgentRecords | null> {
  return recordSource.resolve(label);
}
