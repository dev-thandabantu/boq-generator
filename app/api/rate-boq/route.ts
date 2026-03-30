import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ensureProfileExists } from "@/lib/supabase/ensure-profile";
import { fillMissingRatesInExistingBOQ, RateContext } from "@/lib/claude";
import { extractWorkbookBOQ } from "@/lib/excel";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import type { PostgrestError } from "@supabase/supabase-js";
import { assertPaymentMatchesExpected, loadExpectedPayment, persistCompletedPayment, verifyPayment } from "@/lib/payments";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

function isMissingColumnError(error: PostgrestError | null, columns: string[]): boolean {
  if (!error) return false;
  const haystack = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ").toLowerCase();
  return columns.some((column) => haystack.includes(column.toLowerCase()));
}

function isDuplicateStripeSessionError(error: PostgrestError | null): boolean {
  if (!error) return false;
  const haystack = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ").toLowerCase();
  return (
    error.code === "23505" &&
    (
      haystack.includes("stripe_session_id") ||
      haystack.includes("boqs_stripe_session_id_key") ||
      haystack.includes("payment_reference") ||
      haystack.includes("boqs_payment_reference_key")
    )
  );
}

function classifyError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("too many requests")) {
    return { status: 429, safeMessage: "AI rate limit reached. Please wait a minute and try again." };
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("502") || lower.includes("bad gateway") ||
    lower.includes("503") || lower.includes("service unavailable") ||
    lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset") ||
    lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")
  ) {
    return {
      status: 503,
      safeMessage: "AI service is temporarily unavailable or the Gemini request could not be reached. Please try again in a moment.",
    };
  }
  return { status: 500, safeMessage: "Rate filling failed. Please try again." };
}

export async function POST(req: NextRequest) {
  try {
    const { session_id, transaction_id, rate_context } = (await req.json()) as {
      session_id: string;
      transaction_id?: string;
      rate_context?: RateContext;
    };

    if (!session_id) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
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

    logger.info("Rate payment verified", {
      paymentReference: payment.reference,
      transactionId: payment.processorReference,
      route: "rate-boq",
    });

    const metadata = payment.metadata;
    if (metadata.type !== "rate_boq") {
      return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
    }

    const storageKey = metadata.storage_key;
    const rateColHeader = metadata.rate_col_header ?? "";
    const amountColHeader = metadata.amount_col_header ?? "";
    const boqId = metadata.boq_id ?? expectedPayment.boqId ?? null;

    if (!storageKey) {
      return NextResponse.json({ error: "Missing storage key in payment session" }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    await ensureProfileExists(serviceClient, user);

    // Idempotency: if this Stripe session already produced a paid BOQ, return it
    const { data: existingBoq } = await serviceClient
      .from("boqs")
      .select("id, data")
      .eq("payment_reference", session_id)
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

    // Parse the original workbook deterministically, then fill only missing rates.
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbookBoq = extractWorkbookBOQ(buffer, {
      rateColumnHeader: rateColHeader || null,
      amountColumnHeader: amountColHeader || null,
    });
    const boq = await fillMissingRatesInExistingBOQ(workbookBoq, rate_context);

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
          payment_provider: payment.provider,
          payment_reference: session_id,
          ...(payment.provider === "stripe" ? { stripe_session_id: session_id } : {}),
          source_excel_key: storageKey,
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
      let { data: saved, error: dbError } = await serviceClient
        .from("boqs")
        .insert({
          user_id: user.id,
          title,
          data: boq,
          payment_provider: payment.provider,
          payment_reference: session_id,
          ...(payment.provider === "stripe" ? { stripe_session_id: session_id } : {}),
          source_excel_key: storageKey,
          rate_col_header: rateColHeader || null,
          amount_col_header: amountColHeader || null,
          payment_status: "paid",
        })
        .select("id")
        .single();

      if (isMissingColumnError(dbError, ["source_excel_key", "rate_col_header", "amount_col_header"])) {
        logger.warn("Rate BOQ metadata columns missing; retrying save without Excel metadata", {
          code: dbError?.code,
          message: dbError?.message,
          details: dbError?.details,
          hint: dbError?.hint,
          route: "rate-boq",
        });

        ({ data: saved, error: dbError } = await serviceClient
          .from("boqs")
          .insert({
            user_id: user.id,
            title,
            data: boq,
            payment_provider: payment.provider,
            payment_reference: session_id,
            ...(payment.provider === "stripe" ? { stripe_session_id: session_id } : {}),
            payment_status: "paid",
          })
          .select("id")
          .single());
      }

      if (dbError) {
        if (isDuplicateStripeSessionError(dbError)) {
          logger.warn("Duplicate rate-boq save detected; loading existing row", {
            code: dbError.code,
            message: dbError.message,
            details: dbError.details,
            route: "rate-boq",
          });

          const { data: concurrentBoq } = await serviceClient
            .from("boqs")
            .select("id, data")
            .eq("payment_reference", session_id)
            .maybeSingle();

          if (concurrentBoq?.id) {
            return NextResponse.json({ boq: concurrentBoq.data, boq_id: concurrentBoq.id });
          }
        }

        logger.error("Failed to save rated BOQ", {
          error: String(dbError),
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          hint: dbError.hint,
          route: "rate-boq",
        });
        return NextResponse.json({ boq, boq_id: null });
      }

      if (!saved?.id) {
        logger.error("Rated BOQ save returned no row id", { route: "rate-boq" });
        return NextResponse.json({ boq, boq_id: null });
      }

      savedId = saved.id;
    }

    // Record payment
    await persistCompletedPayment({
      provider: payment.provider,
      reference: payment.reference,
      processorReference: payment.processorReference,
      userId: user.id,
      boqId: savedId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      metadata: payment.metadata,
    });

    trackEvent(user.id, "boq_rated", { boqId: savedId, itemCount, storageKey });
    return NextResponse.json({ boq, boq_id: savedId });
  } catch (err) {
    logger.error("rate-boq error", { error: err instanceof Error ? err.message : String(err), route: "rate-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    const classified = classifyError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
