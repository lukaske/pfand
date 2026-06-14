/** Ledger-style formatting helpers. */

export function shortAddress(addr?: string, lead = 6, tail = 4): string {
  if (!addr) return "—";
  if (addr.length <= lead + tail) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Format a 6-decimal USDC amount (bigint or string) as a human value. */
export function formatUsdc(amount: bigint | string | number, decimals = 6): string {
  const v = typeof amount === "bigint" ? amount : BigInt(Math.round(Number(amount)));
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 2);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${fracStr ? "." + fracStr : ""}`;
}

/**
 * ERC-8004 reputation value is signed fixed-point: value / 10^valueDecimals.
 * Returns a readable score.
 */
export function formatScore(value: number | string, valueDecimals: number): string {
  const v = Number(value) / 10 ** valueDecimals;
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Display name for an agent — its card name, or `Agent #<id>` for bare NFTs. */
export function agentName(a: { name: string; agentId: string }): string {
  return a.name?.trim() || `Agent #${a.agentId}`;
}

/** Two-letter avatar fallback from a name (empty → ""). */
export function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/** Block explorer tx URL for the agent's network (Etherscan for mainnet, Arcscan for Arc). */
export function explorerTxUrl(
  network: "mainnet" | "arc",
  txHash: string,
): string {
  return network === "mainnet"
    ? `https://etherscan.io/tx/${txHash}`
    : `https://testnet.arcscan.app/tx/${txHash}`;
}

/** Block explorer address URL for the agent's network. */
export function explorerAddressUrl(
  network: "mainnet" | "arc",
  address: string,
): string {
  return network === "mainnet"
    ? `https://etherscan.io/address/${address}`
    : `https://testnet.arcscan.app/address/${address}`;
}
