/**
 * Pluggable text embedding for the pgvector `agents.embedding` column.
 *
 * Default: a zero-cost, fully deterministic hashed bag-of-words embedding so
 * hybrid search works offline with no external provider or API key. It is NOT
 * semantically strong — it captures lexical overlap only — but it makes the
 * search_agents() RPC return sensible, stable orderings during the hackathon.
 *
 * TODO(real-embeddings): swap `embed` for a real model (e.g. OpenAI
 * text-embedding-3-small at 1536 dims, or a local @xenova/transformers model).
 * If you change the model, change EMBED_DIM here AND vector(N) in sql/schema.sql
 * (and re-create the agents_embedding_ivf index) so they stay in lockstep.
 */

/** Embedding dimension. MUST equal vector(N) in sql/schema.sql. */
export const EMBED_DIM = 256;

/** FNV-1a 32-bit hash — small, fast, deterministic. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit space
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

/**
 * Deterministic hashed bag-of-words → L2-normalized vector of length EMBED_DIM.
 * Each token is hashed into a bucket with a sign bit (signed hashing trick) to
 * reduce collisions cancelling out.
 */
export function embedDeterministic(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const h = fnv1a(tok);
    const bucket = h % EMBED_DIM;
    const sign = (h & 0x80000000) !== 0 ? -1 : 1;
    vec[bucket] = (vec[bucket] ?? 0) + sign;
    // a second probe for a bit more spread
    const h2 = fnv1a(tok + "#2");
    const bucket2 = h2 % EMBED_DIM;
    const sign2 = (h2 & 0x80000000) !== 0 ? -1 : 1;
    vec[bucket2] = (vec[bucket2] ?? 0) + sign2 * 0.5;
  }
  // L2 normalize so cosine distance behaves well in pgvector.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * The pluggable entry point. Reads PFAND_EMBED_PROVIDER:
 *   - unset / "deterministic" → offline hashed embedding (default)
 *   - anything else           → throws, so you wire a real provider here.
 */
export async function embed(text: string): Promise<number[]> {
  const provider = process.env.PFAND_EMBED_PROVIDER ?? "deterministic";
  if (provider === "deterministic") {
    return embedDeterministic(text ?? "");
  }
  // TODO: implement a real provider branch, e.g.:
  //   if (provider === "openai") { ...call embeddings API, return number[]... }
  throw new Error(
    `Unknown PFAND_EMBED_PROVIDER="${provider}". Implement it in src/embed.ts ` +
      `(and keep EMBED_DIM=${EMBED_DIM} in sync with sql/schema.sql).`,
  );
}

/** pgvector accepts a vector literal as the string "[v1,v2,...]". */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
