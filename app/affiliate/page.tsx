import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AffiliateSignupForm from "./AffiliateSignupForm";
import AffiliateDashboard from "./AffiliateDashboard";

export default async function AffiliatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const serviceClient = createServiceClient();

  const { data: affiliate } = await serviceClient
    .from("affiliates")
    .select("id, referral_code, status, payout_email, commission_type, commission_value, total_earned_cents, total_paid_cents")
    .eq("user_id", user.id)
    .maybeSingle();

  let stats: { conversions: number; pending_commission_cents: number; paid_commission_cents: number } | null = null;
  if (affiliate) {
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

    stats = { conversions, pending_commission_cents: pendingCommissionCents, paid_commission_cents: paidCommissionCents };
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const referralUrl = affiliate ? `${baseUrl}/?ref=${affiliate.referral_code}` : null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0f0f0f]/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="text-sm font-semibold text-white">
            BOQ <span className="text-amber-400">Generator</span>
          </a>
          <a href="/dashboard" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            My BOQs →
          </a>
        </div>
      </nav>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Affiliate <span className="text-amber-400">Program</span>
          </h1>
          <p className="text-gray-400 text-sm">
            Refer clients. Earn cash when they pay.
          </p>
        </div>

        {affiliate && stats && referralUrl ? (
          <AffiliateDashboard
            affiliate={affiliate}
            stats={stats}
            referralUrl={referralUrl}
          />
        ) : (
          <AffiliateSignupForm userEmail={user.email ?? ""} />
        )}
      </div>
    </main>
  );
}
