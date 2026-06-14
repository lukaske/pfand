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
 * ERC-7930 interoperable address of an EVM (eip155) 20-byte address:
 *   version(0001) + chainType eip155(0000) + chainRefLen + chainRef(minimal BE) + addrLen(14) + addr
 * For mainnet (chainId 1) this is the ENSIP-25 canonical `0x00010000010114…` form.
 */
export function erc7930(chainId: number, address: Address): `0x${string}` {
  const addr = getAddress(address).slice(2).toLowerCase();
  let ref = chainId.toString(16);
  if (ref.length % 2) ref = "0" + ref; // pad to whole bytes
  const refLen = (ref.length / 2).toString(16).padStart(2, "0");
  return (`0x0001` + `0000` + refLen + ref + `14` + addr) as `0x${string}`;
}

export function erc7930Mainnet(address: Address): `0x${string}` {
  return erc7930(1, address);
}

/** Arc Testnet ERC-8004 IdentityRegistry as an ERC-7930 address (chainId 5042002). */
export function arcRegistry7930(): `0x${string}` | null {
  const reg = process.env.ARC_IDENTITY_REGISTRY as Address | undefined;
  return reg ? erc7930(5042002, reg) : null;
}

export function agentRegistrationKey(registry7930: `0x${string}`, agentId: string | number): string {
  return `agent-registration[${registry7930}][${agentId}]`;
}

/** The ENS parent the gateway is authoritative for (wildcard `*.<parent>`). */
export function ensParent(): string {
  return process.env.ENS_PARENT_NAME ?? "agent8004.eth";
}

/** Sanitize an arbitrary agent name into a valid ENS label (a-z0-9-, 1..40 chars). */
export function sanitizeEnsLabel(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "agent";
}

export interface AgentRecordInput {
  network: "arc" | "mainnet";
  agentId: string | number;
  addr: Address | null;
  name: string;
  description?: string;
  skills?: string[];
  image?: string | null;
  url?: string | null;
  endpoints?: Partial<Record<"mcp" | "a2a" | "web", string>>;
  /** optional one-line trust summary appended to agent-context */
  trustNote?: string;
}

/**
 * Build the ENSIP-25 + ENSIP-26 record set for one agent. The
 * `agent-registration[...]` key points at the agent's REAL on-chain registry
 * (Arc for MCP-registered agents, mainnet for the seed set), so the ENS name is
 * cryptographically tied to a verifiable ERC-8004 identity — not a vanity label.
 */
export function buildAgentRecords(a: AgentRecordInput): AgentRecords {
  const registry7930 =
    a.network === "arc" ? arcRegistry7930() : erc7930Mainnet(ERC8004_MAINNET.identityRegistry as Address);

  const contextParts = [
    `${a.name} (ERC-8004 #${a.agentId} on ${a.network}).`,
    a.description?.trim(),
    a.skills?.length ? `Skills: ${a.skills.join(", ")}.` : "",
    a.trustNote?.trim(),
  ].filter(Boolean);

  const text: Record<string, string> = {
    "agent-context": contextParts.join(" "),
    "agent-name": a.name,
  };
  if (registry7930) text[agentRegistrationKey(registry7930, a.agentId)] = "1";
  if (a.description?.trim()) text["agent-description"] = a.description.trim();
  if (a.image) text["avatar"] = a.image;
  const web = a.endpoints?.web ?? a.url ?? undefined;
  if (a.endpoints?.mcp) text["agent-endpoint[mcp]"] = a.endpoints.mcp;
  if (a.endpoints?.a2a) text["agent-endpoint[a2a]"] = a.endpoints.a2a;
  if (web) {
    text["agent-endpoint[web]"] = web;
    text["url"] = web;
  }
  return { addr: a.addr, text };
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

export class SeedRecordSource implements AgentRecordSource {
  async resolve(label: string): Promise<AgentRecords | null> {
    const agent = SEED[label.toLowerCase()];
    if (!agent) return null;
    return buildAgentRecords({
      network: "mainnet",
      agentId: agent.agentId,
      addr: agent.addr,
      name: label,
      description: agent.context,
      endpoints: agent.endpoints,
    });
  }
}

/**
 * Resolves agents that registered themselves through the Pfand MCP (written to
 * Supabase with an `ens_name`). This is what makes registration → ENS name
 * instant and fully dynamic — no hard-coded labels, no Sepolia transaction.
 */
export class DbRecordSource implements AgentRecordSource {
  async resolve(label: string): Promise<AgentRecords | null> {
    const ensName = `${label.toLowerCase()}.${ensParent()}`;
    const { getAgentByEnsName } = await import("../db");
    const a = await getAgentByEnsName(ensName);
    if (!a) return null;
    return buildAgentRecords({
      network: a.network,
      agentId: a.agentId,
      addr: (a.addr as Address) ?? null,
      name: a.name,
      description: a.description,
      skills: a.skills,
      image: a.image,
      endpoints: a.endpoints,
      trustNote:
        typeof a.trustRank === "number"
          ? `TrustRank ${a.trustRank.toFixed(2)} (${a.distinctReviews} reviews).`
          : undefined,
    });
  }
}

/** Try self-registered agents first, then the curated mainnet seed set. */
export class CompositeRecordSource implements AgentRecordSource {
  constructor(private sources: AgentRecordSource[]) {}
  async resolve(label: string): Promise<AgentRecords | null> {
    for (const s of this.sources) {
      try {
        const r = await s.resolve(label);
        if (r) return r;
      } catch {
        /* a failing source must not break resolution */
      }
    }
    return null;
  }
}

export const recordSource: AgentRecordSource = new CompositeRecordSource([
  new DbRecordSource(),
  new SeedRecordSource(),
]);

export async function resolveAgentRecords(label: string): Promise<AgentRecords | null> {
  return recordSource.resolve(label);
}
