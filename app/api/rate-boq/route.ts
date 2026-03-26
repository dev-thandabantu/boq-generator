import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { fillMissingRatesInExistingBOQ, RateContext } from "@/lib/claude";
import { extractWorkbookBOQ } from "@/lib/excel";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import type { PostgrestError } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "boq-generator-dev";

function isMissingColumnError(error: PostgrestError | null, columns: string[]): boolean {
  if (!error) return false;
  const haystack = [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ").toLowerCase();
  return columns.some((column) => haystack.includes(column.toLowerCase()));
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

    // Idempotency: if this Stripe session already produced a BOQ, return it
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

    // Parse the original workbook deterministically, then fill only missing rates.
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbookBoq = extractWorkbookBOQ(buffer, {
      rateColumnHeader: rateColHeader || null,
      amountColumnHeader: amountColHeader || null,
    });
    const boq = await fillMissingRatesInExistingBOQ(workbookBoq, rate_context);

    const title = boq.project || "Rated BOQ";

    // Save BOQ to database
    let { data: saved, error: dbError } = await serviceClient
      .from("boqs")
      .insert({
        user_id: user.id,
        title,
        data: boq,
        stripe_session_id: session_id,
        source_excel_key: storageKey,
        rate_col_header: rateColHeader || null,
        amount_col_header: amountColHeader || null,
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
          stripe_session_id: session_id,
        })
        .select("id")
        .single());
    }

    if (dbError) {
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

    // Record payment
    await serviceClient.from("payments").upsert(
      {
        stripe_session_id: session_id,
        stripe_payment_intent: stripeSession.payment_intent as string | null,
        user_id: user.id,
        amount_cents: stripeSession.amount_total ?? 10000,
        currency: stripeSession.currency ?? "usd",
        status: "completed",
        boq_id: saved.id,
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: false }
    );

    const itemCount = boq.bills?.flatMap((b) => b.items).filter((i) => !i.is_header).length ?? 0;
    trackEvent(user.id, "boq_rated", { boqId: saved.id, itemCount, storageKey });
    return NextResponse.json({ boq, boq_id: saved.id });
  } catch (err) {
    logger.error("rate-boq error", { error: err instanceof Error ? err.message : String(err), route: "rate-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    const classified = classifyError(message);
    return NextResponse.json({ error: classified.safeMessage }, { status: classified.status });
  }
}
