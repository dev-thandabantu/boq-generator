import { NextRequest, NextResponse } from "next/server";
import { generateBOQ } from "@/lib/claude";
import { getStripe } from "@/lib/stripe";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, session_id } = body as { text: string; session_id: string };

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

    // Truncate to ~80k chars to stay within token limits
    const truncated =
      text.length > 80000 ? text.slice(0, 80000) + "\n...[truncated]" : text;

    const boq = await generateBOQ(truncated);

    // Save to DB (using service client to bypass RLS)
    const serviceClient = createServiceClient();
    const title = boq.project || "Untitled BOQ";

    const { data: saved, error: dbError } = await serviceClient
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
      // Still return the BOQ so the user isn't left hanging
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

    return NextResponse.json({ boq, boq_id: saved.id });
  } catch (err) {
    console.error("BOQ generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const isQuota =
      message.includes("429") ||
      message.includes("quota") ||
      message.includes("Too Many Requests");
    return NextResponse.json({ error: message }, { status: isQuota ? 429 : 500 });
  }
}
