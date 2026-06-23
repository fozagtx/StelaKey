import { NextResponse } from "next/server";
import { prepareTransferAuthorization, TransferRelayerError } from "@/lib/transfer-relayer";

export const runtime = "nodejs";
export const maxDuration = 60;

function publicPrepareMessage(error: TransferRelayerError) {
  if (error.errorCode === "INVALID_STELLAR_ADDRESS") {
    return "Enter a valid Stellar recipient before preparing the payment.";
  }
  if (error.errorCode === "RELAYER_NOT_CONFIGURED") {
    return "Payment preparation is not available right now.";
  }
  if (error.errorCode === "STELLAR_PREPARE_FAILED") {
    return "Stellar could not prepare this payment. Check that the recipient account exists on testnet, the amount is valid, and the asset is supported.";
  }
  return error.message;
}

export async function POST(request: Request) {
  try {
    const prepared = await prepareTransferAuthorization(await request.json());
    return NextResponse.json(prepared);
  } catch (error) {
    if (error instanceof TransferRelayerError) {
      return NextResponse.json(
        {
          status: "rejected",
          errorCode: error.errorCode,
          message: publicPrepareMessage(error)
        },
        { status: error.status }
      );
    }

    console.error("prepare_auth_failed", error);
    return NextResponse.json(
      {
        status: "rejected",
        errorCode: "PREPARE_AUTH_FAILED",
        message: "Payment could not be prepared before wallet signing."
      },
      { status: 502 }
    );
  }
}
