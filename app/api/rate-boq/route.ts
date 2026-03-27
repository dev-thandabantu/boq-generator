import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { fillBOQRates, RateContext } from "@/lib/claude";
import { excelToCSV } from "@/lib/excel";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

function classifyError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("too many requests")) {
    return { status: 429, safeMessage: "AI rate limit reached. Please wait a minute and try again." };
  }
  if (
    lower.includes("503") || lower.includes("service unavailable") ||
    lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset")
  ) {
    return { status: 503, safeMessage: "AI service is temporarily busy. Please try again in a moment." };
  }
  return { status: 500, safeMessage: "Rate filling failed. Please try again." };
}

export async function POST(req: NextRequest) {
  try {
    const { session_id, rate_context } = (await req.json()) as {
      session_id: string;
      rate_context?: RateContext;
    };

    if (!session_id) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    // Verify Stripe payment
    const stripeSession = await getStripe().checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    const metadata = stripeSession.metadata ?? {};
    if (metadata.type !== "rate_boq") {
      return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
    }

    const storageKey = metadata.storage_key;
    const rateColHeader = metadata.rate_col_header ?? "";
    const amountColHeader = metadata.amount_col_header ?? "";
    const boqId = metadata.boq_id ?? null;

    if (!storageKey) {
      return NextResponse.json({ error: "Missing storage key in payment session" }, { status: 400 });
    }

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();

    // Idempotency: if this Stripe session already produced a paid BOQ, return it
    const { data: existingBoq } = await serviceClient
      .from("boqs")
      .select("id, data")
      .eq("stripe_session_id", session_id)
      .maybeSingle();

    if (existingBoq) {
      return NextResponse.json({ boq: existingBoq.data, boq_id: existingBoq.id });
    }

    // Download original Excel from Storage
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .download(storageKey);

    if (downloadError || !fileData) {
      logger.error("Storage download error", { error: String(downloadError), route: "rate-boq" });
      return NextResponse.json(
        { error: "Could not retrieve your uploaded file. Please try again." },
        { status: 500 }
      );
    }

    // Convert to CSV and fill rates via Claude
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const csvText = excelToCSV(buffer);

    const truncated = csvText.length > 60000 ? csvText.slice(0, 60000) + "\n...[truncated]" : csvText;
    const boq = await fillBOQRates(truncated, rate_context);

    const title = boq.project || "Rated BOQ";
    const itemCount = boq.bills?.flatMap((b) => b.items).filter((i) => !i.is_header).length ?? 0;

    let savedId: string;

    if (boqId) {
      // New flow: UPDATE the preview BOQ row created by ingest-boq
      const { data: updated, error: updateError } = await serviceClient
        .from("boqs")
        .update({
          title,
          data: boq,
          stripe_session_id: session_id,
          payment_status: "paid",
          rate_col_header: rateColHeader || null,
          amount_col_header: amountColHeader || null,
        })
        .eq("id", boqId)
        .eq("user_id", user.id)
        .select("id")
        .single();

      if (updateError || !updated) {
        logger.error("Failed to update preview BOQ with rates", { error: String(updateError), boqId, route: "rate-boq" });
        return NextResponse.json({ boq, boq_id: null });
      }
      savedId = updated.id;
    } else {
      // Legacy flow: INSERT a new BOQ row (no boq_id in metadata)
      const { data: saved, error: dbError } = await serviceClient
        .from("boqs")
        .insert({
          user_id: user.id,
          title,
          data: boq,
          stripe_session_id: session_id,
          source_excel_key: storageKey,
          rate_col_header: rateColHeader || null,
          amount_col_header: amountColHeader || null,
          payment_status: "paid",
        })
        .select("id")
        .single();

      if (dbError) {
        logger.error("Failed to save rated BOQ", { error: String(dbError), route: "rate-boq" });
        return NextResponse.json({ boq, boq_id: null });
      }
      savedId = saved.id;
    }

    // Record payment
    await serviceClient.from("payments").upsert(
      {
        stripe_session_id: session_id,
        stripe_payment_intent: stripeSession.payment_intent as string | null,
        user_id: user.id,
        amount_cents: stripeSession.amount_total ?? 2000,
        currency: stripeSession.currency ?? "usd",
        status: "completed",
        boq_id: savedId,
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: false }
    );

    trackEvent(user.id, "boq_rated", { boqId: savedId, itemCount, storageKey });
    return NextResponse.json({ boq, boq_id: savedId });
  } catch (err) {
    logger.error("rate-boq error", { error: err instanceof Error ? err.message : String(err), route: "rate-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    const classified = classifyError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
