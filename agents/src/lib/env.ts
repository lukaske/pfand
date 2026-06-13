import "dotenv/config";

/**
 * Centralized, lazily-validated environment access.
 *
 * We have NO funded Arc keys yet, so nothing here throws at import time. Each
 * entrypoint decides whether it needs a given var and calls `requireEnv` (hard
 * fail with a clear message) or `optionalEnv` (sim/dry-run friendly).
 */

export type Env = Record<string, string | undefined>;

export const env: Env = process.env;

/** True when `--sim` (or PFAND_SIM=1) is present: log intended actions, never touch the chain. */
export function isSimMode(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--sim") || process.env.PFAND_SIM === "1";
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    throw new Error(
      `Missing required env ${key}. Set it in agents/.env (see .env.example), ` +
        `or run with --sim for a dry-run that logs intended actions instead.`,
    );
  }
  return v;
}

export function optionalEnv(key: string, fallback?: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

/** Normalize a hex private key to the 0x-prefixed form viem expects. */
export function normalizePrivateKey(key: string): `0x${string}` {
  const k = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error("PRIVATE_KEY must be a 32-byte hex string (64 hex chars, optional 0x prefix).");
  }
  return k as `0x${string}`;
}
