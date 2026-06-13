/**
 * Thin Vertex AI (Gemini) wrapper for the Broker8004 agent.
 *
 * Everything here is best-effort: if the GCP project / credentials are not
 * configured, or any call fails, the exported functions return `null` so the
 * broker can fall back to the deterministic `extractFilters` / templated
 * rationale path. We NEVER throw out of this module.
 *
 * Required env (all optional — absence just disables the LLM path):
 *   GCP_PROJECT | GOOGLE_CLOUD_PROJECT   the GCP project id
 *   GCP_LOCATION                          region, defaults to "us-central1"
 *   GOOGLE_APPLICATION_CREDENTIALS        path to a service-account key json
 *   GEMINI_MODEL                          model id, defaults to "gemini-1.5-flash"
 */

import {
  VertexAI,
  type GenerativeModel,
  type GenerateContentResult,
} from "@google-cloud/vertexai";
import type { Agent } from "@pfand/shared";
import { ensureGcpCredentials } from "./gcp-creds";

/** Structured intent the broker derives a SearchFilters + detectedTask from. */
export interface BrokerIntent {
  /** Single best task category, lowercase-kebab, or null. */
  taskTag: string | null;
  skills: string[];
  maxPriceUsdc: number | null;
  minTrust: number | null;
  requiresX402: boolean | null;
  payableOnly: boolean | null;
  freeText: string | null;
}

const MODEL_ID = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function projectId(): string | null {
  return (
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    null
  );
}

function location(): string {
  return process.env.GCP_LOCATION || "us-central1";
}

/** True only when we have enough to even attempt a Vertex call. */
export function llmConfigured(): boolean {
  return projectId() != null;
}

let _model: GenerativeModel | null | undefined;

/** Lazily build (and cache) the GenerativeModel, or null if unconfigured. */
function getModel(): GenerativeModel | null {
  if (_model !== undefined) return _model;
  try {
    ensureGcpCredentials(); // materialize inline SA key on serverless
    const project = projectId();
    if (!project) {
      _model = null;
      return _model;
    }
    const vertex = new VertexAI({ project, location: location() });
    _model = vertex.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    });
    return _model;
  } catch {
    _model = null;
    return _model;
  }
}

/** Pull the first candidate's text out of a Vertex response, defensively. */
function responseText(result: GenerateContentResult): string | null {
  try {
    const parts = result.response?.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    const text = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Extract a JSON object from a model reply that may be fenced or chatty. */
function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  let text = raw.trim();
  // Strip ```json … ``` / ``` … ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Otherwise narrow to the first { … last }.
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    text = text.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* --------------------------------- coercion ------------------------------- */

function asKebab(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, "-");
  return s.length ? s : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

const INTENT_PROMPT = `You are the intent parser for "Broker8004", a broker that finds on-chain AI agents and ranks them by reputation (TrustRank).

Given a user's natural-language request, return STRICT JSON (no prose, no markdown fences) with EXACTLY these keys:
{
  "taskTag": string|null,        // the single best task category for the request, lowercase-kebab (e.g. "solidity-audit", "data-labeling", "rag-retrieval", "image-gen", "summarization"). null if unclear.
  "skills": string[],            // specific skill slugs implied by the request, lowercase-kebab. [] if none.
  "maxPriceUsdc": number|null,   // max price in USDC if a budget/price ceiling is stated, else null.
  "minTrust": number|null,       // 0-100 minimum reputation if the user wants reliable/trusted/high-quality/best, else null.
  "requiresX402": boolean|null,  // true if x402 / gasless / micropayment support is required, else null.
  "payableOnly": boolean|null,   // true if the user wants to hire/pay/buy now (live on Arc), else null.
  "freeText": string|null        // the original request verbatim.
}
Return ONLY the JSON object.

Request: `;

/**
 * Ask Gemini to parse a query into BrokerIntent. Returns null when unconfigured
 * or on any error so callers fall back to deterministic extraction.
 */
export async function extractIntentLLM(
  query: string,
): Promise<BrokerIntent | null> {
  const model = getModel();
  if (!model) return null;
  const q = (query ?? "").trim();
  if (!q) return null;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: INTENT_PROMPT + q }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    const obj = parseJsonObject(responseText(result));
    if (!obj) return null;

    return {
      taskTag: asKebab(obj.taskTag),
      skills: asStringArray(obj.skills),
      maxPriceUsdc: asNumber(obj.maxPriceUsdc),
      minTrust: asNumber(obj.minTrust),
      requiresX402: asBool(obj.requiresX402),
      payableOnly: asBool(obj.payableOnly),
      freeText: typeof obj.freeText === "string" && obj.freeText.trim()
        ? obj.freeText.trim()
        : q,
    };
  } catch {
    return null;
  }
}

/**
 * One-line, plain-English reason this agent fits the query. Returns null when
 * unconfigured or on error so callers use a templated fallback.
 */
export async function rationale(
  query: string,
  agent: Agent,
): Promise<string | null> {
  const model = getModel();
  if (!model) return null;
  const q = (query ?? "").trim();
  if (!q) return null;

  const trust = agent.reputation.trustRank;
  const topTask = agent.reputation.topTask ?? "general work";
  const prompt = `In ONE short sentence (max 18 words, no preamble, no quotes), say why the agent below fits the user's request. Mention its strength concretely.

User request: "${q}"
Agent: ${agent.name}
Skills: ${agent.skills.join(", ") || "n/a"}
Best at: ${topTask}
TrustRank: ${trust ?? "unrated"}/100
Price: ${agent.priceUsdc != null ? agent.priceUsdc + " USDC" : "free"}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const text = responseText(result);
    if (!text) return null;
    // Single line, strip wrapping quotes.
    return text.split("\n")[0].replace(/^["']|["']$/g, "").trim() || null;
  } catch {
    return null;
  }
}
