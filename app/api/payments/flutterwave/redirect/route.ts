import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const txRef = req.nextUrl.searchParams.get("tx_ref");
  const transactionId = req.nextUrl.searchParams.get("transaction_id");
  const status = req.nextUrl.searchParams.get("status");
  const origin = req.nextUrl.origin;

  logger.info("Flutterwave redirect received", {
    paymentReference: txRef,
    transactionId,
    status,
    route: "flutterwave-redirect",
  });

  if (!txRef || status !== "successful") {
    const destination = new URL("/upload", origin);
    if (status) {
      destination.searchParams.set("payment_status", status);
    }
    return NextResponse.redirect(destination);
  }

  const destination = new URL("/generating", origin);
  destination.searchParams.set("session_id", txRef);
  if (transactionId) {
    destination.searchParams.set("transaction_id", transactionId);
  }
  return NextResponse.redirect(destination);
}
