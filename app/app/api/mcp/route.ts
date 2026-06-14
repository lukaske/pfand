import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { broker } from "@/lib/broker";
import { getAgent } from "@/lib/db";
import { ENGINES, invokeAgentEngine } from "@/lib/agent-engine";
import { agentName } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Pfand MCP server — lets any LLM agent (Claude included) connect to the
 * ERC-8004 agent economy through one trusted layer: discover agents ranked by
 * TrustRank, then hire them. Streamable-HTTP transport, hosted on Vercel.
 *
 *   Endpoint:  https://pfand.vercel.app/api/mcp
 */
const handler = createMcpHandler((server) => {
  server.tool(
    "search_agents",
    "Search ERC-8004 agents by natural-language need, ranked by TrustRank (EigenTrust over the on-chain trust graph). Returns the best-matching agents with their trust scores and evidence.",
    {
      query: z
        .string()
        .describe("the need, e.g. 'reliable solidity auditor that takes x402'"),
      limit: z.number().int().min(1).max(20).optional(),
    },
    async ({ query, limit }) => {
      const res = await broker(query);
      const results = res.results.slice(0, limit ?? 5).map((a) => ({
        agentId: a.agentId,
        name: agentName(a),
        network: a.network,
        trustRank: a.reputation.trustRank,
        topTask: a.reputation.topTask,
        evidence: a.reputation.evidence,
        ensName: a.ensName,
        hireable: Object.keys(ENGINES).includes(a.agentId),
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { detectedTask: res.detectedTask, source: res.source, results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "get_agent",
    "Get the full profile of one ERC-8004 agent — TrustRank, evidence (distinct reviews / payments), tags, and recent feedback.",
    { agentId: z.string() },
    async ({ agentId }) => {
      const data = await getAgent(agentId);
      if (!data)
        return {
          content: [{ type: "text", text: `Agent #${agentId} not found.` }],
        };
      const { agent, feedback } = data;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agentId: agent.agentId,
                name: agentName(agent),
                network: agent.network,
                trustRank: agent.reputation.trustRank,
                distrustFlag: agent.reputation.distrustFlag,
                evidence: agent.reputation.evidence,
                tags: agent.reputation.tags,
                skills: agent.skills,
                feedbackCount: feedback.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "hire_agent",
    "Hire one of the live Pfand-brokered agents to do a task. Free to call; the Broker is the only x402-charged surface. Returns the agent's answer.",
    {
      agent: z
        .enum(Object.keys(ENGINES) as [string, ...string[]])
        .describe("the agent slug to hire"),
      message: z.string().describe("the task / question for the agent"),
    },
    async ({ agent, message }) => {
      const ref = ENGINES[agent];
      if (!ref)
        return { content: [{ type: "text", text: `Unknown agent '${agent}'.` }] };
      try {
        const text = await invokeAgentEngine(ref, message);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Agent error: ${(err as Error).message}` },
          ],
        };
      }
    },
  );
});

export { handler as GET, handler as POST, handler as DELETE };
