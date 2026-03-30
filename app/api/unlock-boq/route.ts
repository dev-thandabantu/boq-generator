import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { assertPaymentMatchesExpected, loadExpectedPayment, persistCompletedPayment, verifyPayment } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { session_id, transaction_id } = (await req.json()) as { session_id: string; transaction_id?: string };

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

    const expectedPayment = await loadExpectedPayment(session_id);
    if (expectedPayment.userId && expectedPayment.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payment = await verifyPayment(session_id, transaction_id);
    if (!payment.paid) {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    assertPaymentMatchesExpected(payment, expectedPayment);

    logger.info("Unlock payment verified", {
      paymentReference: payment.reference,
      transactionId: payment.processorReference,
      route: "unlock-boq",
    });

    const boqId = payment.metadata.boq_id ?? expectedPayment.boqId;
    if (!boqId) {
      return NextResponse.json({ error: "No BOQ linked to this session" }, { status: 404 });
    }

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

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
      await persistCompletedPayment({
        provider: payment.provider,
        reference: payment.reference,
        processorReference: payment.processorReference,
        userId: user.id,
        boqId,
        amountCents: payment.amountCents,
        currency: payment.currency,
        metadata: payment.metadata,
      });
    }

    trackEvent(user.id, "boq_unlocked", { boqId, sessionId: session_id });

    return NextResponse.json({ boq: boqRow.data, boq_id: boqRow.id });
  } catch (err) {
    logger.error("unlock-boq error", { error: err instanceof Error ? err.message : String(err), route: "unlock-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
