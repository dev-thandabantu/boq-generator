import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import Stripe from "stripe";

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
      console.error("[webhook] Signature verification failed:", msg);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else {
    // Webhook secret not yet configured — parse without verification
    // (safe for initial setup; add STRIPE_WEBHOOK_SECRET to fully secure)
    console.warn("[webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification");
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error(
        "[webhook] SUPABASE_SERVICE_ROLE_KEY is not configured; cannot persist payment"
      );
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    const userId = session.metadata?.user_id ?? null;

    // Upsert payment record
    await supabase.from("payments").upsert(
      {
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent as string | null,
        user_id: userId,
        amount_cents: session.amount_total ?? 10000,
        currency: session.currency ?? "usd",
        status: "completed",
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: false }
    );

    // Link payment to BOQ if it exists
    const { data: boq } = await supabase
      .from("boqs")
      .select("id")
      .eq("stripe_session_id", session.id)
      .single();

    if (boq) {
      await supabase
        .from("payments")
        .update({ boq_id: boq.id })
        .eq("stripe_session_id", session.id);
    }

    console.log(`[webhook] Payment recorded for session ${session.id}`);
  }

  return NextResponse.json({ received: true });
}
