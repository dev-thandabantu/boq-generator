import { NextRequest, NextResponse } from "next/server";
import { generateBOQ, validateSOW } from "@/lib/claude";
import type { GenerationInputDocument } from "@/lib/claude";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 120;

function classifyGenerateError(message: string): { status: number; safeMessage: string } {
  const lower = message.toLowerCase();
  const isQuota =
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("too many requests");
  if (isQuota) {
    return {
      status: 429,
      safeMessage: "AI rate limit reached. Please wait a minute and try again.",
    };
  }

  const isTemporaryUnavailable =
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("high demand") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset");

  if (isTemporaryUnavailable) {
    return {
      status: 503,
      safeMessage: "AI service is temporarily busy. Please try again in a moment.",
    };
  }

  return { status: 500, safeMessage: "BOQ generation failed. Please try again." };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, documents, session_id, suggest_rates } = body as {
      text?: string;
      documents?: GenerationInputDocument[];
      session_id: string;
      suggest_rates?: boolean;
      is_sow?: boolean;
      sow_warning?: string;
      document_type?: string;
      should_block_generation?: boolean;
    };
    const primaryDocument =
      documents?.find((doc) => doc.role === "primary") ??
      (typeof text === "string"
        ? {
            document_id: "primary",
            name: "Primary SOW",
            role: "primary" as const,
            document_type: "construction_sow" as const,
            text,
            pages: null,
          }
        : null);

    if (!primaryDocument || typeof primaryDocument.text !== "string") {
      return NextResponse.json({ error: "primary document text is required" }, { status: 400 });
    }

    if (primaryDocument.text.length < 50) {
      return NextResponse.json(
        { error: "Text too short — could not extract meaningful content from PDF" },
        { status: 400 }
      );
    }

    if (!session_id) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    const supportingDocsCount = (documents ?? []).filter((doc) => doc.role === "supporting").length;
    const validation = await validateSOW(primaryDocument.text, { supportingDocsCount });
    const clientSaysNotSOW = body.is_sow === false;
    if (!validation.isSOW || validation.should_block_generation || clientSaysNotSOW || body.should_block_generation) {
      const reason =
        validation.reason ||
        body.sow_warning ||
        "This document does not appear to be a construction Scope of Work suitable for BOQ generation.";
      return NextResponse.json(
        {
          error: reason,
          document_type: validation.documentType || body.document_type || "unknown",
        },
        { status: 422 }
      );
    }

    // Verify payment
    const stripeSession = await getStripe().checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve DB client early so we can use it for idempotency check
    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!hasServiceRole) {
      logger.warn("SUPABASE_SERVICE_ROLE_KEY not set; falling back to user-scoped inserts", { route: "generate" });
    }
    const dbClient = hasServiceRole ? createServiceClient() : supabase;

    // Idempotency: if this Stripe session already produced a BOQ, return it
    const { data: existingBoq } = await dbClient
      .from("boqs")
      .select("id, data")
      .eq("stripe_session_id", session_id)
      .maybeSingle();

    if (existingBoq) {
      return NextResponse.json({ boq: existingBoq.data, boq_id: existingBoq.id });
    }

    // Truncate to ~80k chars to stay within token limits
    const truncatedDocuments = (documents ?? [primaryDocument]).map((doc) => ({
      ...doc,
      text:
        doc.text.length > 80000
          ? doc.text.slice(0, 80000) + "\n...[truncated]"
          : doc.text,
    }));

    const boq = await generateBOQ(
      { documents: truncatedDocuments },
      {
        suggestRates: suggest_rates ?? false,
        documentClassification: validation,
      }
    );

    const title = boq.project || "Untitled BOQ";

    try {
      const { data: saved, error: dbError } = await dbClient
        .from("boqs")
        .insert({
          user_id: user.id,
          title,
          data: boq,
          stripe_session_id: session_id,
        })
        .select("id")
        .single();

      if (dbError) {
        logger.error("Failed to save BOQ to DB", { error: String(dbError), route: "generate" });
        return NextResponse.json({ boq, boq_id: null });
      }

      
      // Record payment when we have a saved BOQ
      await dbClient.from("payments").upsert(
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
      trackEvent(user.id, "boq_generated", { boqId: saved.id, title, itemCount });
      return NextResponse.json({ boq, boq_id: saved.id });
    } catch (saveErr) {
      logger.error("Failed to save BOQ or record payment", { error: String(saveErr), route: "generate" });
      return NextResponse.json({ boq, boq_id: null });
    }
  } catch (err) {
    logger.error("BOQ generation error", { error: err instanceof Error ? err.message : String(err), route: "generate" });
    const message = err instanceof Error ? err.message : "Unknown error";
    
    const isExtractionFailure =
      message.includes("Could not extract BOQ structure") ||
      message.includes("no measurable items found");
    if (isExtractionFailure) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    const classified = classifyGenerateError(message);
    return NextResponse.json(
      { error: classified.safeMessage },
      { status: classified.status }
    );
  }
}
