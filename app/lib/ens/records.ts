/**
 * Pfand ENS record resolution for <agent>.agent8004.eth.
 *
 * Produces ENSIP-25 (verifiable agent identity) + ENSIP-26 (native AI identity)
 * text records plus an address for a given subname label. Ported from the
 * standalone gateway so the records are served from the deployed Next app.
 *
 * The SEED entries are REAL Ethereum-mainnet ERC-8004 agents (agentId + real
 * owner wallet + live service endpoints), so the ENSIP-25 `agent-registration`
 * key points at a genuinely-resolvable (registry, agentId) pair on mainnet.
 */

import { getAddress, type Address } from "viem";
import { ERC8004_MAINNET } from "@pfand/shared";

export interface AgentRecords {
  addr: Address | null;
  text: Record<string, string>;
}

export interface AgentRecordSource {
  resolve(label: string): Promise<AgentRecords | null>;
}

/**
 * ERC-7930 interoperable address of an Ethereum-mainnet 20-byte address:
 *   version(0001) + chainType eip155(0000) + refLen(01) + ref mainnet(01) + addrLen(14) + addr
 * Matches the ENSIP-25 canonical example for 0x8004A169…a432.
 */
export function erc7930Mainnet(address: Address): `0x${string}` {
  const addr = getAddress(address).slice(2).toLowerCase();
  return (`0x00010000010114` + addr) as `0x${string}`;
}

export function agentRegistrationKey(registry7930: `0x${string}`, agentId: string | number): string {
  return `agent-registration[${registry7930}][${agentId}]`;
}

interface SeedAgent {
  addr: Address;
  agentId: number;
  context: string;
  endpoints: Partial<Record<"mcp" | "a2a" | "web", string>>;
}

const SEED: Record<string, SeedAgent> = {
  story: {
    addr: "0xc468ff1b3c7043878422a272280e19f47127cc6c",
    agentId: 14645,
    context:
      "Story Scoring Agent (ERC-8004 #14645). Scores user stories (0-100); score >=60 grants " +
      "one claim of 100 Story tokens. Pay 10 USDC to claim. 106 verified on-chain feedback, score 87/100.",
    endpoints: { mcp: "https://8004mint.com/mcp", web: "https://8004scan.app/agent/14645" },
  },
  gekko: {
    addr: "0xb73ea3f24340f3b5d70e4ca57f84b53b88aba3a7",
    agentId: 13445,
    context:
      "Gekko AI (ERC-8004 #13445). AI portfolio manager: trading strategies, DeFi yield optimization, " +
      "real-time market intelligence on Base. 83 verified on-chain feedback, score 92/100.",
    endpoints: { a2a: "https://gekkoterminal.xyz/.well-known/agent-card.json", web: "https://gekkoterminal.xyz" },
  },
  openodds: {
    addr: "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
    agentId: 22771,
    context:
      "OpenOdds.Ai (ERC-8004 #22771). Verifiable pre-match football odds: five-model consensus, xG " +
      "context, on-chain commit-reveal. 49 verified on-chain feedback, score 89/100.",
    endpoints: { a2a: "https://openodds.ai/.well-known/a2a-agent-card.json", web: "https://openodds.ai" },
  },
  dackie: {
    addr: "0x69f65af7f5a235909d8b249541d232b596fa379a",
    agentId: 9382,
    context:
      "Captain Dackie (ERC-8004 #9382). DeFAI + x402 AI agent from Capminal. 47 verified on-chain " +
      "feedback, score 87/100. x402-payable.",
    endpoints: { a2a: "https://app.virtuals.io/virtuals/23397", web: "https://app.virtuals.io/virtuals/23397" },
  },
  ethy: {
    addr: "0xe0865ffca21a8f120a80997cbbdba8c92cac5697",
    agentId: 9380,
    context:
      "Ethy AI (ERC-8004 #9380). Vibe trading agent: plain-language strategies into live 24/7 " +
      "automations. A2A + x402 + ERC-8004 reputation. 29 verified on-chain feedback, score 84/100.",
    endpoints: { a2a: "https://chat.ethyai.app/.well-known/a2a/agent.json", web: "https://ethyai.app" },
  },
  // stable aliases for demos/scripts
  alice: {
    addr: "0xc468ff1b3c7043878422a272280e19f47127cc6c",
    agentId: 14645,
    context: "Story Scoring Agent (ERC-8004 #14645), aliased as 'alice'. 106 feedback, score 87/100.",
    endpoints: { mcp: "https://8004mint.com/mcp", web: "https://8004scan.app/agent/14645" },
  },
};

const MAINNET_REGISTRY_7930 = erc7930Mainnet(ERC8004_MAINNET.identityRegistry as Address);

export class SeedRecordSource implements AgentRecordSource {
  async resolve(label: string): Promise<AgentRecords | null> {
    const agent = SEED[label.toLowerCase()];
    if (!agent) return null;
    const text: Record<string, string> = {
      [agentRegistrationKey(MAINNET_REGISTRY_7930, agent.agentId)]: "1",
      "agent-context": agent.context,
    };
    if (agent.endpoints.mcp) text["agent-endpoint[mcp]"] = agent.endpoints.mcp;
    if (agent.endpoints.a2a) text["agent-endpoint[a2a]"] = agent.endpoints.a2a;
    if (agent.endpoints.web) text["agent-endpoint[web]"] = agent.endpoints.web;
    return { addr: agent.addr, text };
  }
}

export const recordSource: AgentRecordSource = new SeedRecordSource();

export async function resolveAgentRecords(label: string): Promise<AgentRecords | null> {
  return recordSource.resolve(label);
}
