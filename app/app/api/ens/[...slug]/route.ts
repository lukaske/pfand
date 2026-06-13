import { NextResponse } from "next/server";
import { getAddress, isHex, type Hex } from "viem";
import { handleResolve, signerAddress } from "@/lib/ens/resolver";

// Node runtime (viem signing) + never cached: each lookup is signed fresh.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

/**
 * CCIP-Read gateway endpoint (EIP-3668). The Sepolia OffchainResolver is deployed
 * with url = `${origin}/api/ens/{sender}/{data}.json`, so clients call:
 *   GET /api/ens/{sender}/{data}.json
 * plus a health probe at GET /api/ens/health.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  if (slug?.[0] === "health") {
    return NextResponse.json({ ok: true, signer: signerAddress() }, { headers: CORS });
  }

  const sender = slug?.[0];
  const data = slug?.[1]?.replace(/\.json$/, "");

  if (!sender || !data || !isHex(sender) || !isHex(data)) {
    return NextResponse.json({ message: "Bad request: expected /{sender}/{data}.json" }, { status: 400, headers: CORS });
  }

  try {
    const responseData = await handleResolve(getAddress(sender), data as Hex);
    return NextResponse.json({ data: responseData }, { headers: CORS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 400, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
