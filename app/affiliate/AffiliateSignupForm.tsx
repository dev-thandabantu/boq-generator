"use client";

import { useState } from "react";

export default function AffiliateSignupForm({ userEmail }: { userEmail: string }) {
  const [payoutEmail, setPayoutEmail] = useState(userEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ referralCode: string; referralUrl: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/affiliate/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payout_email: payoutEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setSuccess({ referralCode: data.affiliate.referral_code, referralUrl: data.referral_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Application received!</h2>
        <p className="text-gray-400 text-sm">
          Your account is under review. Once activated, you&apos;ll start earning on every referral.
        </p>
        <div className="rounded-lg bg-white/[0.03] border border-white/10 px-4 py-3 text-left">
          <p className="text-xs text-gray-400 mb-1">Your referral link (save this):</p>
          <p className="text-sm text-amber-300 font-mono break-all">{success.referralUrl}</p>
        </div>
        <p className="text-xs text-gray-500">
          Your code: <span className="font-mono text-white">{success.referralCode}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* How it works */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">How it works</h2>
        <div className="space-y-3">
          {[
            { step: "1", text: "Sign up and get a unique referral link" },
            { step: "2", text: "Share it with QS professionals, contractors, and consultants" },
            { step: "3", text: "Earn a cash commission every time someone pays via your link" },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-amber-400/20 text-amber-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {step}
              </div>
              <p className="text-sm text-gray-300">{text}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <p className="text-sm text-amber-300 font-medium">Default commission: $5 per paid BOQ</p>
          <p className="text-xs text-gray-400 mt-0.5">Commission structure may be adjusted per affiliate.</p>
        </div>
      </div>

      {/* Signup form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="payout-email" className="block text-sm font-medium text-white mb-2">
            Payout email
          </label>
          <input
            id="payout-email"
            type="email"
            value={payoutEmail}
            onChange={(e) => setPayoutEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="w-full px-4 py-2.5 rounded-lg bg-white/[0.05] border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-amber-400/60"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            We&apos;ll send payouts to this email (via bank transfer or mobile money).
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-black/40 border-t-transparent animate-spin" />
              Applying...
            </>
          ) : "Apply to become an affiliate →"}
        </button>
      </form>
    </div>
  );
}
