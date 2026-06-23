import { NextResponse } from "next/server";
import { submitAuthorizedTransfer, TransferRelayerError } from "@/lib/transfer-relayer";

export const runtime = "nodejs";
export const maxDuration = 60;

function publicSubmitMessage(error: TransferRelayerError) {
  if (error.errorCode === "RELAYER_NOT_CONFIGURED") {
    return "Payment submission is not available right now. No transaction was submitted.";
  }
  if (error.errorCode === "STELLAR_TRANSFER_FAILED") {
    return "Stellar rejected the payment transaction. No confirmed transaction hash is available.";
  }
  if (error.errorCode === "TRANSFER_CONFIRMATION_TIMEOUT") {
    return "Stellar accepted the payment request, but confirmation timed out. Check account activity before trying again.";
  }
  return error.message;
}

export async function POST(request: Request) {
  try {
    const submitted = await submitAuthorizedTransfer(await request.json());
    return NextResponse.json(submitted);
  } catch (error) {
    if (error instanceof TransferRelayerError) {
      return NextResponse.json(
        {
          status: "rejected",
          errorCode: error.errorCode,
          message: publicSubmitMessage(error)
        },
        { status: error.status }
      );
    }

    console.error("submit_transfer_failed", error);
    return NextResponse.json(
      {
        status: "rejected",
        errorCode: "TRANSFER_SUBMIT_FAILED",
        message: "Payment submission failed before Stellar confirmed a transaction."
      },
      { status: 502 }
    );
  }
}
