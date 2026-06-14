import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { broker } from "@/lib/broker";
import {
  getAgent,
  insertArcFeedback,
  insertArcAgent,
  rescoreArc,
  ensNameTaken,
  getAgentByEnsName,
} from "@/lib/db";
import {
  sanitizeEnsLabel,
  ensParent,
  buildAgentRecords,
  resolveAgentRecords,
} from "@/lib/ens/records";
import { ENGINES, resolveEngine, invokeAgentEngine } from "@/lib/agent-engine";
import {
  postReview,
  openEscrowJob,
  claimRebate,
  registerAgent,
  registrarAddress,
  registerConfigured,
  onchainConfigured,
  type ReviewState,
} from "@/lib/onchain";
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
const handler = createMcpHandler(
  (server) => {
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
          hireable: !!resolveEngine(a.agentId),
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
      "Get the full profile of one ERC-8004 agent — TrustRank, evidence (distinct reviews / payments), tags, and feedback count.",
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
                  ensName: agent.ensName,
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
      "register_agent",
      "Register a NEW agent on Arc ERC-8004 AND mint it a human-readable ENS identity (<label>.agent8004.eth) with ENSIP-25 (verifiable on-chain registration) + ENSIP-26 (agent-context, endpoints) text records. The ENS name resolves instantly (offchain CCIP-read, no gas) and is cryptographically tied to the agent's real Arc registration. Returns the on-chain agentId and the ENS name. The agent starts unrated and earns TrustRank as it's hired and reviewed.",
      {
        name: z.string().describe("display name; also the basis for the ENS label"),
        description: z.string(),
        skills: z.array(z.string()).optional(),
        serviceEndpoint: z
          .string()
          .optional()
          .describe("a callable URL for the agent (used as the web endpoint)"),
        endpoints: z
          .object({
            mcp: z.string().optional().describe("Model Context Protocol URL"),
            a2a: z.string().optional().describe("Agent-to-Agent card/URL"),
            web: z.string().optional().describe("human-facing URL"),
          })
          .optional()
          .describe("ENSIP-26 agent endpoints, published as ENS text records"),
        wallet: z
          .string()
          .optional()
          .describe("the agent's own 0x address — becomes its ENS addr record + payTo (defaults to the registrar)"),
        image: z.string().optional().describe("avatar URL, published as the ENS avatar record"),
      },
      async ({ name, description, skills, serviceEndpoint, endpoints, wallet, image }) => {
        if (!registerConfigured())
          return {
            content: [
              {
                type: "text",
                text: "On-chain registration not configured (missing Arc registrar key).",
              },
            ],
          };
        try {
          const owner = registrarAddress();
          const payTo = (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet : owner) as string;
          const eps = {
            ...(endpoints ?? {}),
            ...(serviceEndpoint && !endpoints?.web ? { web: serviceEndpoint } : {}),
          };
          const card = {
            name,
            description,
            image: image ?? null,
            skills: skills ?? [],
            domains: [],
            x402Support: false,
            service: serviceEndpoint
              ? { endpoint: serviceEndpoint, method: "POST", priceUsdc: 0, payTo }
              : undefined,
            payToWallet: payTo,
            endpoints: eps,
          };
          const { agentId, txHash, agentURI } = await registerAgent(card);

          // Mint the ENS identity: readable label from the name, agentId suffix on
          // collision. Resolution is offchain wildcard, so the name is live the
          // instant the row is written — no Sepolia transaction.
          const base = sanitizeEnsLabel(name);
          const parent = ensParent();
          let label = base;
          if (await ensNameTaken(`${base}.${parent}`)) label = `${base}-${agentId}`;
          const ensName = `${label}.${parent}`;

          await insertArcAgent({
            agentId,
            owner,
            agentURI,
            name,
            description,
            image: image ?? null,
            skills: skills ?? [],
            serviceEndpoint: serviceEndpoint ?? null,
            x402Support: false,
            ensName,
            payToWallet: payTo,
          });
          await rescoreArc();

          const records = buildAgentRecords({
            network: "arc",
            agentId,
            addr: payTo as `0x${string}`,
            name,
            description,
            skills: skills ?? [],
            image: image ?? null,
            endpoints: eps,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    agentId,
                    network: "arc",
                    ensName,
                    addr: payTo,
                    onChainTx: txHash,
                    ensRecords: records.text,
                    note: `Registered on Arc ERC-8004 and resolvable at ${ensName} now (ENSIP-25/26 records live, offchain/no-gas). Discoverable via search_agents and resolve_agent; unrated until hired & reviewed.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Registration failed: ${(err as Error).message}`,
              },
            ],
          };
        }
      },
    );

    server.tool(
      "resolve_agent",
      "Resolve an agent by its ENS name (e.g. 'travel-concierge.agent8004.eth' or just 'travel-concierge') and return its ENSIP-25/26 records, address, on-chain agentId and TrustRank. This is how agents discover each other through ENS.",
      {
        name: z
          .string()
          .describe("the ENS name or bare label, e.g. 'gekko.agent8004.eth' or 'gekko'"),
      },
      async ({ name }) => {
        const parent = ensParent();
        const label = name.toLowerCase().replace(new RegExp(`\\.${parent}$`), "").split(".")[0];
        const records = await resolveAgentRecords(label);
        if (!records)
          return {
            content: [
              { type: "text", text: `No agent resolves at ${label}.${parent}.` },
            ],
          };
        const dbAgent = await getAgentByEnsName(`${label}.${parent}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ensName: `${label}.${parent}`,
                  addr: records.addr,
                  agentId: dbAgent?.agentId ?? null,
                  network: dbAgent?.network ?? "mainnet",
                  trustRank: dbAgent?.trustRank ?? null,
                  records: records.text,
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
      "Hire a live Pfand-brokered agent. Free to call. Opens a Pfand escrow job on Arc and returns a jobId — you MUST then call review_agent with that jobId to release the deposit and mint the agent's trust edge.",
      {
        agent: z
          .enum(Object.keys(ENGINES) as [string, ...string[]])
          .describe("the agent slug to hire"),
        message: z.string().describe("the task / question for the agent"),
      },
      async ({ agent, message }) => {
        const ref = ENGINES[agent];
        if (!ref)
          return {
            content: [{ type: "text", text: `Unknown agent '${agent}'.` }],
          };
        let answer: string;
        try {
          answer = await invokeAgentEngine(ref, message);
        } catch (err) {
          answer = `Agent error: ${(err as Error).message}`;
        }
        // Open the Pfand escrow job (best-effort; fee 0 → no USDC moved).
        let jobId: string | null = null;
        let escrowNote = "escrow unavailable";
        if (onchainConfigured()) {
          try {
            // Small fee → a real 0.05 USDC Pfand bond, returned on review.
            const job = await openEscrowJob(ref.agentId, ref.serviceWallet, 0.5);
            jobId = job.jobId;
            escrowNote = `Pfand job #${jobId} opened on Arc (tx ${job.txHash.slice(0, 10)}…)`;
          } catch (err) {
            escrowNote = `escrow failed: ${(err as Error).message}`;
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agent: ref.slug,
                  agentId: ref.agentId,
                  answer,
                  jobId,
                  escrow: escrowNote,
                  next: `Call review_agent({ agent: "${ref.slug}", state: "good"|"neutral"|"bad", jobId: ${jobId ? `"${jobId}"` : "null"} }) to release the deposit and record your review on-chain.`,
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
      "review_agent",
      "Leave the on-chain ERC-8004 sign review for an agent you hired (good = 👍, neutral = 😐, bad = 👎). This mints the trust edge, releases your Pfand deposit, and updates the agent's TrustRank. Required to close the loop.",
      {
        agent: z
          .enum(Object.keys(ENGINES) as [string, ...string[]])
          .describe("the agent slug you hired"),
        state: z
          .enum(["good", "neutral", "bad"])
          .describe("your verdict on the work"),
        jobId: z
          .string()
          .nullable()
          .optional()
          .describe("the jobId returned by hire_agent (to release the Pfand)"),
      },
      async ({ agent, state, jobId }) => {
        const ref = resolveEngine(agent);
        if (!ref)
          return {
            content: [{ type: "text", text: `Unknown agent '${agent}'.` }],
          };
        if (!onchainConfigured())
          return {
            content: [
              {
                type: "text",
                text: "On-chain reviews are not configured (missing Arc signer).",
              },
            ],
          };
        try {
          // 1. Post the sign review on-chain (Arc ReputationRegistry).
          const review = await postReview(
            ref.agentId,
            state as ReviewState,
            ref.slug,
            `https://pfand.vercel.app/api/invoke/${ref.slug}`,
          );
          // 2. Mirror it into the index so TrustRank can move.
          await insertArcFeedback({
            agentId: ref.agentId,
            client: review.client,
            value: review.value,
            tag1: review.tag1,
            tag2: review.tag2,
            txHash: review.txHash,
          });
          // 3. Release the Pfand deposit if a job is open (best-effort). The claim
          //    names this review's feedback index, so it can only settle this one job.
          let claimNote = "no job to claim";
          if (jobId) {
            try {
              const claimTx = await claimRebate(jobId, review.feedbackIndex);
              claimNote = `Pfand released (tx ${claimTx.slice(0, 10)}…)`;
            } catch (err) {
              claimNote = `claim failed: ${(err as Error).message}`;
            }
          }
          // 4. Re-score so the agent's TrustRank updates immediately.
          const scores = await rescoreArc();
          const newRank = scores.get(`arc:${ref.agentId}`)?.trustRank ?? null;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    agent: ref.slug,
                    agentId: ref.agentId,
                    review: state,
                    onChainTx: review.txHash,
                    pfand: claimNote,
                    newTrustRank: newRank,
                    note: "Review recorded on-chain and TrustRank updated. The agent is now discoverable / climbs in search.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Review failed: ${(err as Error).message}` },
            ],
          };
        }
      },
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
