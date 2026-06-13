/** Tiny narrative logger for the demo. No deps, ANSI-light. */

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

export const log = {
  step(n: number | string, msg: string): void {
    console.log(`\n${c.bold}${c.cyan}[${n}]${c.reset} ${c.bold}${msg}${c.reset}`);
  },
  info(msg: string): void {
    console.log(`    ${msg}`);
  },
  detail(label: string, value: string): void {
    console.log(`    ${c.dim}${label}:${c.reset} ${value}`);
  },
  tx(label: string, hash: string): void {
    console.log(`    ${c.green}↳ ${label} tx${c.reset} ${c.dim}${hash}${c.reset}`);
  },
  money(label: string, value: string): void {
    console.log(`    ${c.yellow}$ ${label}${c.reset} ${value}`);
  },
  ok(msg: string): void {
    console.log(`    ${c.green}✓ ${msg}${c.reset}`);
  },
  warn(msg: string): void {
    console.log(`    ${c.yellow}! ${msg}${c.reset}`);
  },
  error(msg: string): void {
    console.log(`    ${c.red}✗ ${msg}${c.reset}`);
  },
  sim(msg: string): void {
    console.log(`    ${c.magenta}[sim]${c.reset} ${msg}`);
  },
  banner(title: string): void {
    const line = "─".repeat(Math.max(8, title.length + 4));
    console.log(`\n${c.bold}${c.magenta}┌${line}┐${c.reset}`);
    console.log(`${c.bold}${c.magenta}│  ${title}  │${c.reset}`);
    console.log(`${c.bold}${c.magenta}└${line}┘${c.reset}`);
  },
};

/** Format USDC 6-dec base units as a human dollar string. */
export function formatUsdc6(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${neg ? "-" : ""}$${whole.toString()}.${frac} USDC`;
}

/** Parse a human dollar string ("0.05" / "$0.05") to USDC 6-dec base units. */
export function parseUsdc6(human: string): bigint {
  const cleaned = human.replace(/[$,\s]/g, "");
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracPadded || "0");
}
