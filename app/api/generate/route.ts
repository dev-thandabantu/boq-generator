import { NextRequest, NextResponse } from "next/server";
import { generateBOQ } from "@/lib/claude";
import { stripe } from "@/lib/stripe";

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

    // Verify payment
    if (!session_id) {
      return NextResponse.json({ error: "Payment required" }, { status: 402 });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
    }

    // Truncate to ~80k chars to stay within token limits
    const truncated = text.length > 80000 ? text.slice(0, 80000) + "\n...[truncated]" : text;

    const boq = await generateBOQ(truncated);

    return NextResponse.json({ boq });
  } catch (err) {
    console.error("BOQ generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const isQuota = message.includes("429") || message.includes("quota") || message.includes("Too Many Requests");
    return NextResponse.json(
      { error: message },
      { status: isQuota ? 429 : 500 }
    );
  }
}
