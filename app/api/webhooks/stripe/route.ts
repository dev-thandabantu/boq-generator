import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { persistCompletedPayment } from "@/lib/payments";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  if (webhookSecret && sig) {
    try {
      event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Webhook error";
      logger.error("Webhook signature verification failed", { error: msg, route: "webhook" });
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else {
    logger.warn("STRIPE_WEBHOOK_SECRET not set — skipping verification", { route: "webhook" });
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id ?? null;
    const boqId = session.metadata?.boq_id ?? null;

    await persistCompletedPayment({
      provider: "stripe",
      reference: session.id,
      processorReference:
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      userId,
      boqId,
      amountCents: session.amount_total ?? 2000,
      currency: session.currency ?? "usd",
      metadata: session.metadata ?? {},
    });

    logger.info("Payment recorded", { sessionId: session.id, boqId, route: "webhook" });

    if (userId) {
      trackEvent(userId, "payment_completed", {
        amountCents: session.amount_total,
        currency: session.currency,
        type: session.metadata?.type ?? "generate_boq",
        boqId,
      });
    }
  }

  return NextResponse.json({ received: true });
}
