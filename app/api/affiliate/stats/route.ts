import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();

    const { data: affiliate, error: affiliateError } = await serviceClient
      .from("affiliates")
      .select("id, referral_code, status, payout_email, commission_type, commission_value, total_earned_cents, total_paid_cents, created_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (affiliateError) {
      logger.error("Failed to fetch affiliate", { error: String(affiliateError), route: "affiliate/stats" });
      return NextResponse.json({ error: "Failed to load affiliate data" }, { status: 500 });
    }

    if (!affiliate) {
      return NextResponse.json({ error: "Not an affiliate" }, { status: 404 });
    }

    // Aggregate referrals
    const { data: referrals } = await serviceClient
      .from("referrals")
      .select("commission_cents, status")
      .eq("affiliate_id", affiliate.id);

    const conversions = (referrals ?? []).filter((r) =>
      r.status === "confirmed" || r.status === "paid"
    ).length;

    const pendingCommissionCents = (referrals ?? [])
      .filter((r) => r.status === "confirmed")
      .reduce((sum, r) => sum + (r.commission_cents ?? 0), 0);

    const paidCommissionCents = (referrals ?? [])
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + (r.commission_cents ?? 0), 0);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.headers.get("origin") ?? "";

    return NextResponse.json({
      affiliate: {
        referral_code: affiliate.referral_code,
        status: affiliate.status,
        payout_email: affiliate.payout_email,
        commission_type: affiliate.commission_type,
        commission_value: affiliate.commission_value,
        total_earned_cents: affiliate.total_earned_cents,
        total_paid_cents: affiliate.total_paid_cents,
      },
      stats: {
        conversions,
        pending_commission_cents: pendingCommissionCents,
        paid_commission_cents: paidCommissionCents,
        referral_url: `${baseUrl}/?ref=${affiliate.referral_code}`,
      },
    });
  } catch (err) {
    logger.error("affiliate/stats error", { error: err instanceof Error ? err.message : String(err), route: "affiliate/stats" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
