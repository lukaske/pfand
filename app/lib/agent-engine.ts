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
}

/** Registered Agent-Engine agents reachable through the Broker. */
export const ENGINES: Record<string, EngineRef> = {
  "deep-search": {
    slug: "deep-search",
    name: "Deep Search",
    project: "pfand-ethglobal",
    location: "us-central1",
    engineId: "6177151432601370624",
  },
  "travel-concierge": {
    slug: "travel-concierge",
    name: "Travel Concierge",
    project: "pfand-ethglobal",
    location: "us-east1",
    engineId: "8224030316415680512",
  },
};

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

/** Run a one-shot query against an ADK Agent-Engine agent; returns its text reply. */
export async function invokeAgentEngine(
  ref: EngineRef,
  message: string,
  userId = "pfand-broker",
): Promise<string> {
  const client = clientFor(ref.location);
  const name = `projects/${ref.project}/locations/${ref.location}/reasoningEngines/${ref.engineId}`;

  const [sess] = await client.queryReasoningEngine({
    name,
    classMethod: "create_session",
    input: toStruct({ user_id: userId }),
  });
  const sid =
    (sess as { output?: { structValue?: { fields?: { id?: { stringValue?: string } } } } })
      ?.output?.structValue?.fields?.id?.stringValue ?? "";

  const stream = client.streamQueryReasoningEngine({
    name,
    classMethod: "stream_query",
    input: toStruct({ user_id: userId, session_id: sid, message }),
  });

  let raw = "";
  for await (const resp of stream as AsyncIterable<{ data?: Uint8Array }>) {
    if (resp?.data) raw += Buffer.from(resp.data).toString("utf8");
  }
  return extractText(raw) || "(the agent returned no text for this query)";
}
