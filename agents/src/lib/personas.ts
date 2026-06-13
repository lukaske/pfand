/**
 * ERC-8004 agent registration definitions for our demo service agents.
 *
 * These double as (a) the JSON we register in the IdentityRegistry (`register(agentURI)`)
 * and (b) the persona/skill the service agent uses to drive Claude.
 *
 * The registration JSON follows the ERC-8004 "agent card" shape that our indexer
 * (packages/shared db.ts `Agent`) consumes: name, description, skills, x402Support,
 * service endpoint + advertised price.
 */

export interface AgentPersona {
  /** Stable slug used for filenames and the default route. */
  slug: string;
  name: string;
  description: string;
  skills: string[];
  domains: string[];
  /** Headline price in human USDC (what x402 will charge per call). */
  priceUsdc: number;
  /** HTTP route the service agent exposes for this skill, e.g. "/audit". */
  route: string;
  /** System prompt that turns Claude into this agent. */
  systemPrompt: string;
}

export const PERSONAS: Record<string, AgentPersona> = {
  auditor: {
    slug: "solidity-auditor",
    name: "Solidity Auditor Agent",
    description:
      "Audits submitted Solidity for security vulnerabilities, returns structured findings (severity, location, fix).",
    skills: ["solidity-audit", "security-review", "smart-contracts"],
    domains: ["security", "ethereum", "defi"],
    priceUsdc: 0.05,
    route: "/audit",
    systemPrompt:
      "You are a senior smart-contract security auditor. You will be given Solidity source. " +
      "Return ONLY a JSON object matching: " +
      `{"summary": string, "findings": [{"severity": "critical"|"high"|"medium"|"low"|"info", "title": string, "location": string, "detail": string, "recommendation": string}], "score": number /* 0-100 overall safety */}. ` +
      "Be precise and concrete. If the code is safe, return an empty findings array and a high score. Do not include prose outside the JSON.",
  },
  gasOptimizer: {
    slug: "gas-optimizer",
    name: "Gas Optimizer Agent",
    description:
      "Reviews Solidity for gas inefficiencies and returns concrete optimizations with estimated savings.",
    skills: ["gas-optimization", "solidity", "smart-contracts"],
    domains: ["performance", "ethereum"],
    priceUsdc: 0.03,
    route: "/optimize",
    systemPrompt:
      "You are a Solidity gas-optimization specialist. Given Solidity source, return ONLY JSON matching: " +
      `{"summary": string, "optimizations": [{"title": string, "location": string, "detail": string, "estGasSaved": string}], "score": number /* 0-100, higher = already efficient */}. ` +
      "No prose outside the JSON.",
  },
  docWriter: {
    slug: "natspec-writer",
    name: "NatSpec Doc Writer Agent",
    description: "Generates NatSpec documentation for submitted Solidity functions and contracts.",
    skills: ["documentation", "natspec", "solidity"],
    domains: ["docs", "ethereum"],
    priceUsdc: 0.02,
    route: "/document",
    systemPrompt:
      "You are a technical writer for smart contracts. Given Solidity source, return ONLY JSON matching: " +
      `{"summary": string, "docs": [{"symbol": string, "natspec": string}], "score": number /* 0-100 doc-completeness of the input */}. ` +
      "No prose outside the JSON.",
  },
};

/** The three agents the seed script registers + the demo loop hires. */
export const SEED_PERSONA_KEYS = ["auditor", "gasOptimizer", "docWriter"] as const;

/**
 * Build the ERC-8004 registration JSON ("agent card") for a persona.
 * @param serviceWallet wallet that receives x402 payments (defaults to the registering owner)
 * @param baseUrl       public base URL the service agent is reachable at
 */
export function buildRegistration(
  persona: AgentPersona,
  serviceWallet: string,
  baseUrl: string,
): Record<string, unknown> {
  return {
    name: persona.name,
    description: persona.description,
    image: null,
    skills: persona.skills,
    domains: persona.domains,
    x402Support: true,
    service: {
      endpoint: `${baseUrl.replace(/\/$/, "")}${persona.route}`,
      method: "POST",
      priceUsdc: persona.priceUsdc,
      payTo: serviceWallet,
    },
    payToWallet: serviceWallet,
  };
}
