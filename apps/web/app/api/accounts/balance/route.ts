import { NextResponse } from "next/server";
import { AccountFundingError, getContractXlmBalance } from "@/lib/account-funding";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const accountContractId = new URL(request.url).searchParams.get("accountContractId");
    if (!accountContractId) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: "ACCOUNT_CONTRACT_REQUIRED",
          message: "accountContractId is required."
        },
        { status: 400 }
      );
    }

    const balance = await getContractXlmBalance(accountContractId);
    return NextResponse.json({
      ok: true,
      accountContractId,
      ...balance
    });
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
        errorCode: "BALANCE_LOOKUP_FAILED",
        message: error instanceof Error ? error.message : "XLM balance lookup failed."
      },
      { status: 502 }
    );
  }
}
