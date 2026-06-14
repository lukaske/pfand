/**
 * Vertex AI Agent Engine (ADK) bridge.
 *
 * The reasoning engines only answer over gRPC (the REST `:query` verb 404s), so
 * we use the official `@google-cloud/aiplatform` client. Flow for an ADK agent:
 *   create_session(user_id)  →  stream_query(user_id, session_id, message)
 * stream_query returns a server stream of HttpBody chunks; the model's reply
 * lives in `content.parts[].text` across the streamed ADK events.
 *
 * Auth: the SA materialized by gcp-creds (GCP_SA_KEY_B64 on Vercel / a key file
 * locally). Free — no x402; only the Broker charges.
 */
import aiplatform from "@google-cloud/aiplatform";
import { ensureGcpCredentials } from "./gcp-creds";

const { ReasoningEngineExecutionServiceClient } = aiplatform.v1;
type REClient = InstanceType<typeof ReasoningEngineExecutionServiceClient>;

export interface EngineRef {
  slug: string;
  name: string;
  project: string;
  location: string;
  engineId: string;
  /** ERC-8004 agentId on Arc (for reviews / escrow). */
  agentId: string;
  /** Arc wallet that "performs" the work (the agent's payTo). */
  serviceWallet: string;
}

const DEPLOYER = "0x4AEDE02c0BB911424420C50A03e26092179252aC";

/** Registered Agent-Engine agents reachable through the Broker (Arc 8004). */
export const ENGINES: Record<string, EngineRef> = {
  "deep-search": {
    slug: "deep-search",
    name: "Deep Search",
    project: "pfand-ethglobal",
    location: "us-central1",
    engineId: "6177151432601370624",
    agentId: "19",
    serviceWallet: DEPLOYER,
  },
  "travel-concierge": {
    slug: "travel-concierge",
    name: "Travel Concierge",
    project: "pfand-ethglobal",
    location: "us-east1",
    engineId: "8224030316415680512",
    agentId: "20",
    serviceWallet: DEPLOYER,
  },
};

/** Resolve an engine by slug or by its on-chain Arc agentId. */
export function resolveEngine(idOrSlug: string): EngineRef | undefined {
  return (
    ENGINES[idOrSlug] ??
    Object.values(ENGINES).find((e) => e.agentId === idOrSlug)
  );
}

const _clients = new Map<string, REClient>();
function clientFor(location: string): REClient {
  ensureGcpCredentials();
  let c = _clients.get(location);
  if (!c) {
    c = new ReasoningEngineExecutionServiceClient({
      apiEndpoint: `${location}-aiplatform.googleapis.com`,
    });
    _clients.set(location, c);
  }
  return c;
}

/** Wrap a flat string map as a google.protobuf.Struct literal. */
function toStruct(o: Record<string, string>) {
  return {
    fields: Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, { stringValue: String(v) }]),
    ),
  };
}

/**
 * Pull every top-level JSON object out of the concatenated stream (string-aware
 * brace scanner) and collect the model text from each event's content.parts.
 */
function extractText(raw: string): string {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const ev = JSON.parse(raw.slice(start, i + 1));
          for (const p of ev?.content?.parts ?? [])
            if (typeof p?.text === "string") out.push(p.text);
        } catch {
          /* partial / non-event chunk */
        }
        start = -1;
      }
    }
  }
  return out.join("").trim();
}

/** Surface an ADK error event ({code, message}) from the raw stream, if any. */
function extractError(raw: string): string | null {
  let depth = 0,
    start = -1,
    inStr = false,
    esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const ev = JSON.parse(raw.slice(start, i + 1));
          if (ev?.code && typeof ev?.message === "string") return ev.message;
        } catch {
          /* ignore */
        }
        start = -1;
      }
    }
  }
  return null;
}

async function streamRaw(
  client: REClient,
  name: string,
  classMethod: string,
  input: Record<string, string>,
): Promise<string> {
  const stream = client.streamQueryReasoningEngine(
    { name, classMethod, input: toStruct(input) },
    { timeout: 280_000 },
  );
  let raw = "";
  for await (const resp of stream as AsyncIterable<{ data?: Uint8Array }>) {
    if (resp?.data) raw += Buffer.from(resp.data).toString("utf8");
  }
  return raw;
}

/**
 * Run a one-shot query against an ADK Agent-Engine agent; returns its text reply.
 *
 * ADK agents differ: some expose `stream_query` with a plain string message
 * (auto-sessions); others only expose `streaming_agent_run_with_events`, which
 * wants the message as a Content mapping. We try the simple path first, then
 * fall back, and surface any agent-side error (e.g. an unavailable model).
 */
export async function invokeAgentEngine(
  ref: EngineRef,
  message: string,
  userId = "pfand-broker",
): Promise<string> {
  const client = clientFor(ref.location);
  const name = `projects/${ref.project}/locations/${ref.location}/reasoningEngines/${ref.engineId}`;

  // 1) stream_query with a plain string message.
  const raw1 = await streamRaw(client, name, "stream_query", {
    user_id: userId,
    message,
  });
  const t1 = extractText(raw1);
  if (t1) return t1;

  // 2) streaming_agent_run_with_events with message as a Content mapping.
  const raw2 = await streamRaw(client, name, "streaming_agent_run_with_events", {
    request_json: JSON.stringify({
      user_id: userId,
      message: { role: "user", parts: [{ text: message }] },
    }),
  });
  const t2 = extractText(raw2);
  if (t2) return t2;

  const err = extractError(raw2) ?? extractError(raw1);
  if (err) throw new Error(`agent error: ${err}`);
  return "(the agent returned no text for this query)";
}
