import Anthropic from "@anthropic-ai/sdk";
import { optionalEnv } from "./env.js";
import type { AgentPersona } from "./personas.js";

/**
 * Real Claude-backed work for a service agent. Given a persona system prompt and
 * a user payload (typically Solidity source), returns the parsed JSON result.
 *
 * Falls back to a clearly-marked stub when ANTHROPIC_API_KEY is absent so the
 * server still runs end-to-end in a creds-free environment.
 */

const MODEL = optionalEnv("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

export interface WorkResult {
  /** Whether a real model call was made (vs. an offline stub). */
  live: boolean;
  result: unknown;
}

export async function runAgentWork(persona: AgentPersona, input: string): Promise<WorkResult> {
  const apiKey = optionalEnv("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      live: false,
      result: {
        summary: `[stub: no ANTHROPIC_API_KEY] ${persona.name} would analyze the submitted input here.`,
        findings: [],
        score: 100,
        _note: "Set ANTHROPIC_API_KEY in agents/.env to get real Claude-backed analysis.",
      },
    };
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: persona.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Analyze the following input for skill "${persona.skills[0]}". Respond with JSON only.\n\n\`\`\`\n${input}\n\`\`\``,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { live: true, result: parseJsonLoose(text) };
}

/** Models sometimes wrap JSON in fences or prose; extract the first JSON object. */
function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return { summary: "Model returned non-JSON output.", raw: text };
  }
}
