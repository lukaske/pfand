import { NextResponse, type NextRequest } from "next/server";
import type { Agent, AgentNetwork } from "@pfand/shared";
import { getAgents } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SortKey = "score" | "price" | "feedback" | "recent";

function sortAgents(list: Agent[], sort: SortKey): Agent[] {
  const arr = [...list];
  switch (sort) {
    case "price":
      return arr.sort(
        (a, b) => (a.priceUsdc ?? Infinity) - (b.priceUsdc ?? Infinity),
      );
    case "feedback":
      return arr.sort((a, b) => b.reputation.count - a.reputation.count);
    case "recent":
      return arr.sort(
        (a, b) => (b.createdAtBlock ?? 0) - (a.createdAtBlock ?? 0),
      );
    case "score":
    default:
      // Prefer EigenTrust TrustRank; fall back to the normalized average when an
      // agent is unrated so the ordering stays stable.
      return arr.sort(
        (a, b) =>
          (b.reputation.trustRank ?? b.reputation.scoreNormalized ?? -1) -
          (a.reputation.trustRank ?? a.reputation.scoreNormalized ?? -1),
      );
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const network = sp.get("network") as AgentNetwork | "all" | null;
  const skill = sp.get("skill");
  const x402 = sp.get("x402");
  const payable = sp.get("payable");
  const sort = (sp.get("sort") as SortKey | null) ?? "score";

  const all = await getAgents();

  let list = all.filter((a) => {
    if (network && network !== "all" && a.network !== network) return false;
    if (skill && skill !== "all" && !a.skills.includes(skill)) return false;
    if (x402 === "true" && !a.x402Support) return false;
    if (payable === "true" && !a.payable) return false;
    return true;
  });

  list = sortAgents(list, sort);

  return NextResponse.json({ agents: list, total: list.length });
}
