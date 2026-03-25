import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

function generateReferralCode(): string {
  // 8-character alphanumeric code
  return randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { payout_email?: string };
    const payoutEmail = body.payout_email?.trim();

    if (!payoutEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payoutEmail)) {
      return NextResponse.json({ error: "Valid payout email is required" }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Check not already an affiliate
    const { data: existing } = await serviceClient
      .from("affiliates")
      .select("id, referral_code, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.headers.get("origin") ?? "";
      return NextResponse.json({
        affiliate: existing,
        referral_url: `${baseUrl}/?ref=${existing.referral_code}`,
      });
    }

    // Generate unique referral code (retry up to 3 times on collision)
    let referralCode: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateReferralCode();
      const { data: clash } = await serviceClient
        .from("affiliates")
        .select("id")
        .eq("referral_code", candidate)
        .maybeSingle();
      if (!clash) {
        referralCode = candidate;
        break;
      }
    }

    if (!referralCode) {
      return NextResponse.json({ error: "Could not generate a unique referral code. Please try again." }, { status: 500 });
    }

    const { data: affiliate, error: insertError } = await serviceClient
      .from("affiliates")
      .insert({
        user_id: user.id,
        referral_code: referralCode,
        payout_email: payoutEmail,
        status: "pending",
      })
      .select("id, referral_code, status, payout_email, commission_type, commission_value")
      .single();

    if (insertError || !affiliate) {
      logger.error("Failed to create affiliate", { error: String(insertError), route: "affiliate/signup" });
      return NextResponse.json({ error: "Failed to register. Please try again." }, { status: 500 });
    }

    trackEvent(user.id, "affiliate_signup", { referralCode, payoutEmail });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.headers.get("origin") ?? "";
    return NextResponse.json({
      affiliate,
      referral_url: `${baseUrl}/?ref=${referralCode}`,
    });
  } catch (err) {
    logger.error("affiliate/signup error", { error: err instanceof Error ? err.message : String(err), route: "affiliate/signup" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
