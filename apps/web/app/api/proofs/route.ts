import { NextResponse } from "next/server";
import { createProof, ProverError } from "@/lib/prover-service";

export const runtime = "nodejs";
export const maxDuration = 300;

function publicProofMessage(error: ProverError) {
  if (error.errorCode === "PROVER_NOT_CONFIGURED") {
    return "Authorization is unavailable because the proof service is not configured. No transaction was submitted.";
  }
  if (error.errorCode === "PROOF_GENERATION_FAILED") {
    return "Authorization could not be completed because the proof service could not generate a valid proof. No transaction was submitted.";
  }
  return error.message;
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createProof(await request.json()));
  } catch (error) {
    if (error instanceof ProverError) {
      if (error.status >= 500) {
        console.error("proof_generation_failed", {
          errorCode: error.errorCode,
          message: error.message
        });
      }
      return NextResponse.json(
        {
          status: "rejected",
          errorCode: error.errorCode,
          message: publicProofMessage(error)
        },
        { status: error.status }
      );
    }

    console.error("proof_generation_failed", error);
    return NextResponse.json(
      {
        status: "rejected",
        errorCode: "PROOF_GENERATION_FAILED",
        message: "Authorization could not be completed because the proof service failed. No transaction was submitted."
      },
      { status: 500 }
    );
  }
}
