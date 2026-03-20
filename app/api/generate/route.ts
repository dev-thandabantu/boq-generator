import { NextRequest, NextResponse } from "next/server";
import { generateBOQ, validateSOW } from "@/lib/claude";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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
    const { text, session_id, suggest_rates } = body as {
      text: string;
      session_id: string;
      suggest_rates?: boolean;
      is_sow?: boolean;
      sow_warning?: string;
      document_type?: string;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (text.length < 50) {
      return NextResponse.json(
        { error: "Text too short — could not extract meaningful content from PDF" },
        { status: 400 }
      );
    }

    if (!session_id) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    const validation = await validateSOW(text);
    const clientSaysNotSOW = body.is_sow === false;
    if (!validation.isSOW || clientSaysNotSOW) {
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
      console.warn("[generate] SUPABASE_SERVICE_ROLE_KEY not set; falling back to user-scoped inserts");
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
    const truncated =
      text.length > 80000 ? text.slice(0, 80000) + "\n...[truncated]" : text;

    const boq = await generateBOQ(truncated, { suggestRates: suggest_rates ?? false });

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
        console.error("Failed to save BOQ to DB:", dbError);
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

      
      return NextResponse.json({ boq, boq_id: saved.id });
    } catch (saveErr) {
      console.error("Failed to save BOQ or record payment:", saveErr);
      return NextResponse.json({ boq, boq_id: null });
    }
  } catch (err) {
    console.error("BOQ generation error:", err);
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
