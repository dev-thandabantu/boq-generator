import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { session_id } = (await req.json()) as { session_id: string };

    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify payment with Stripe
    const stripeSession = await getStripe().checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    const boqId = stripeSession.metadata?.boq_id;
    if (!boqId) {
      return NextResponse.json({ error: "No BOQ linked to this session" }, { status: 404 });
    }

    const serviceClient = createServiceClient();

    // Fetch the BOQ — also update payment_status if webhook hasn't fired yet
    const { data: boqRow, error: fetchError } = await serviceClient
      .from("boqs")
      .select("id, data, payment_status, user_id")
      .eq("id", boqId)
      .single();

    if (fetchError || !boqRow) {
      logger.error("Failed to fetch BOQ in unlock", { boqId, error: String(fetchError), route: "unlock-boq" });
      return NextResponse.json({ error: "BOQ not found" }, { status: 404 });
    }

    // Verify ownership
    if (boqRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // If webhook hasn't fired yet, mark it paid now (idempotent)
    if (boqRow.payment_status === "preview") {
      const { error: updateError } = await serviceClient
        .from("boqs")
        .update({ payment_status: "paid", stripe_session_id: session_id })
        .eq("id", boqId);

      if (updateError) {
        logger.error("Failed to mark BOQ as paid in unlock", { boqId, error: String(updateError), route: "unlock-boq" });
      }

      // Also upsert payment record in case webhook was delayed
      await serviceClient.from("payments").upsert(
        {
          stripe_session_id: session_id,
          stripe_payment_intent: stripeSession.payment_intent as string | null,
          user_id: user.id,
          amount_cents: stripeSession.amount_total ?? 2000,
          currency: stripeSession.currency ?? "usd",
          status: "completed",
          boq_id: boqId,
        },
        { onConflict: "stripe_session_id", ignoreDuplicates: false }
      );
    }

    trackEvent(user.id, "boq_unlocked", { boqId, sessionId: session_id });

    return NextResponse.json({ boq: boqRow.data, boq_id: boqRow.id });
  } catch (err) {
    logger.error("unlock-boq error", { error: err instanceof Error ? err.message : String(err), route: "unlock-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
