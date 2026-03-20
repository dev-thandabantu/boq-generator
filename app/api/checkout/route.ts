import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      filename?: string;
      type?: "generate_boq" | "rate_boq";
      storageKey?: string;
      rateColHeader?: string;
      amountColHeader?: string;
    };
    const { filename, type = "generate_boq", storageKey, rateColHeader, amountColHeader } = body;
    const origin = req.headers.get("origin") || "http://localhost:3001";

    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isRateBoq = type === "rate_boq";

    if (isRateBoq && !storageKey) {
      return NextResponse.json({ error: "storageKey is required for rate_boq" }, { status: 400 });
    }

    const metadata: Record<string, string> = { user_id: user.id, type };
    if (isRateBoq && storageKey) {
      metadata.storage_key = storageKey;
      if (rateColHeader) metadata.rate_col_header = rateColHeader;
      if (amountColHeader) metadata.amount_col_header = amountColHeader;
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: user.email ?? undefined,
      metadata,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 10000, // $100.00
            product_data: {
              name: isRateBoq ? "BOQ Rate Filling" : "BOQ Generation",
              description: isRateBoq
                ? "AI fills missing rates in your existing Bill of Quantities"
                : `AI-generated Bill of Quantities for: ${filename || "your project"}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/generating?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/upload`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
