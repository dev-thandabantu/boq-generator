import Footer from "@/components/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">
            BOQ <span className="text-amber-400">Generator</span>
          </span>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-xs text-gray-400 hover:text-white transition-colors hidden sm:block">
              My BOQs
            </a>
            <a
              href="/upload"
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors"
            >
              Generate BOQ →
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative flex flex-col items-center justify-center text-center px-4 pt-40 pb-28">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-amber-500/10 rounded-full blur-[140px]" />
          </div>
          <div className="relative z-10 max-w-3xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium mb-2">
              Built for Zambian construction professionals
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
              From Scope of Work
              <br />
              to <span className="text-amber-400">Tender-Ready BOQ</span>
              <br />
              in 60 seconds
            </h1>
            <p className="text-gray-400 text-lg leading-relaxed max-w-xl mx-auto">
              Upload your Scope of Work document — PDF or Word. Our AI extracts every line item,
              groups them into proper bills, and delivers a structured Bill of Quantities in
              standard Zambian tender format.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <a
                href="/upload"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-base transition-colors"
              >
                Generate your BOQ →
              </a>
              <a
                href="/dashboard"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-semibold text-base transition-colors"
              >
                View my BOQs
              </a>
            </div>
            <p className="text-xs text-gray-600 pt-1">
              One-time payment · Instant delivery · Secure checkout via Stripe
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-5xl mx-auto px-4 py-20">
          <h2 className="text-2xl font-bold text-center text-white mb-12">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Upload your document",
                desc: "Upload a Scope of Work PDF or Word document — up to 15 MB. We extract the text instantly.",
              },
              {
                step: "02",
                title: "Pay once",
                desc: "Fee is based on your project size — from $20 to $500. Secure checkout via Stripe. No subscription, no hidden costs.",
              },
              {
                step: "03",
                title: "Get your BOQ",
                desc: "Receive a structured, editable BOQ. Review line items, add rates, and download your .xlsx in seconds.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-3"
              >
                <span className="text-3xl font-bold text-amber-400/30 font-mono">{item.step}</span>
                <h3 className="font-semibold text-white">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What you get */}
        <section className="max-w-5xl mx-auto px-4 py-10 pb-20">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 sm:p-12">
            <h2 className="text-2xl font-bold text-white mb-8">What you get</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                "Preliminary & General items bill — always included",
                "Bills grouped by trade: Earthworks, Concrete, Structural Steel, Electrical, and more",
                "Standard Zambian BOQ format with ZMW pricing columns",
                "Item numbers, descriptions, units, and quantities extracted from your SOW",
                "Optional AI rate estimates based on the current Zambian construction market",
                "In-browser editing — adjust any item before downloading",
                "AI BOQ Assistant to refine and restructure your BOQ",
                "Download as .xlsx — ready for tender submission",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-gray-300">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="max-w-5xl mx-auto px-4 py-10 pb-24 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Simple pricing</h2>
          <p className="text-gray-400 text-sm mb-10">No subscriptions. Pay only when you need a BOQ.</p>
          <div className="inline-block rounded-2xl border border-amber-500/30 bg-[#0f0f0f] p-8 text-left min-w-[280px]">
            <p className="text-5xl font-bold text-amber-400 mb-1">$20 – $500</p>
            <p className="text-gray-400 text-sm mb-6">USD · one-time per BOQ · based on project size</p>
            <ul className="space-y-2 mb-8">
              {[
                "Full structured BOQ",
                "Unlimited edits in-browser",
                "Excel download included",
                "BOQ saved to your account",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                  <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="/upload"
              className="block w-full py-3.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-sm text-center transition-colors"
            >
              Generate my BOQ →
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
