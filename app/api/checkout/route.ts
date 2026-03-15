import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { filename } = (await req.json()) as { filename: string };
    const origin = req.headers.get("origin") || "http://localhost:3001";

    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: user.email ?? undefined,
      metadata: { user_id: user.id },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 10000, // $100.00
            product_data: {
              name: "BOQ Generation",
              description: `AI-generated Bill of Quantities for: ${filename || "your project"}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/generating?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
