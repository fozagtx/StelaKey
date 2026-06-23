import { NextResponse } from "next/server";
import { AccountFundingError, fundStelaKeyAccount } from "@/lib/account-funding";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const funded = await fundStelaKeyAccount(await request.json());
    return NextResponse.json(funded);
  } catch (error) {
    if (error instanceof AccountFundingError) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: error.errorCode,
          message: error.message
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        errorCode: "ACCOUNT_FUNDING_FAILED",
        message: error instanceof Error ? error.message : "Account funding failed before Stellar confirmed a transaction."
      },
      { status: 502 }
    );
  }
}
