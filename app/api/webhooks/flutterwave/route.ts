import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  assertPaymentMatchesExpected,
  loadExpectedPayment,
  persistCompletedPayment,
  verifyFlutterwaveWebhookSignature,
  verifyPayment,
} from "@/lib/payments";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();

  if (!verifyFlutterwaveWebhookSignature(body, req.headers)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    data?: {
      id?: number | string;
      tx_ref?: string;
    };
  };

  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reference = event.data?.tx_ref;
  const transactionId = event.data?.id ? String(event.data.id) : null;
  logger.info("Flutterwave webhook received", {
    eventType: event.event ?? null,
    paymentReference: reference,
    transactionId,
    route: "flutterwave-webhook",
  });

  if (event.event && event.event !== "charge.completed") {
    return NextResponse.json({ received: true });
  }

  if (!reference) {
    return NextResponse.json({ received: true });
  }

  try {
    const expectedPayment = await loadExpectedPayment(reference);
    const payment = await verifyPayment(reference, transactionId);
    if (!payment.paid) {
      return NextResponse.json({ received: true });
    }

    assertPaymentMatchesExpected(payment, expectedPayment);

    const userId = payment.metadata.user_id ?? expectedPayment.userId ?? null;
    const boqId = payment.metadata.boq_id ?? expectedPayment.boqId ?? null;

    await persistCompletedPayment({
      provider: payment.provider,
      reference: payment.reference,
      processorReference: payment.processorReference,
      userId,
      boqId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      metadata: payment.metadata,
    });

    logger.info("Flutterwave payment recorded", {
      paymentReference: payment.reference,
      transactionId: payment.processorReference,
      boqId,
      route: "flutterwave-webhook",
    });

    if (userId) {
      trackEvent(userId, "payment_completed", {
        amountCents: payment.amountCents,
        currency: payment.currency,
        type: payment.metadata.type ?? "generate_boq",
        boqId,
      });
    }
  } catch (err) {
    logger.error("Flutterwave webhook error", {
      error: err instanceof Error ? err.message : String(err),
      reference,
      route: "flutterwave-webhook",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
