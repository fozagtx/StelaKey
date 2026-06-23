import { NextResponse } from "next/server";
import { createChallenge, ProverError } from "@/lib/prover-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return NextResponse.json(createChallenge(await request.json()));
  } catch (error) {
    if (error instanceof ProverError) {
      return NextResponse.json(
        {
          status: "rejected",
          errorCode: error.errorCode,
          message: error.message
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        status: "rejected",
        errorCode: "INVALID_CHALLENGE_REQUEST",
        message: error instanceof Error ? error.message : "Challenge request failed."
      },
      { status: 400 }
    );
  }
}
