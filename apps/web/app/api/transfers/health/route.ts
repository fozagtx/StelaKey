import { NextResponse } from "next/server";
import { transferRelayerReadiness } from "@/lib/transfer-relayer";

export const runtime = "nodejs";

export async function GET() {
  const { config, missing } = transferRelayerReadiness();
  return NextResponse.json({
    ok: missing.length === 0,
    service: "stelakey-transfer",
    status: missing.length === 0 ? "prepare-auth-ready" : "missing-config",
    missing,
    network: config.network,
    rpcUrl: config.rpcUrl
  });
}
