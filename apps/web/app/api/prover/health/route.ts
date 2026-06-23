import { NextResponse } from "next/server";
import { proverRuntimeReadiness } from "@/lib/prover-service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await proverRuntimeReadiness());
}
