"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { usePostHog } from "posthog-js/react";

function GeneratingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const ph = usePostHog();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(10);
  const [statusText, setStatusText] = useState(
    "AI is reading your Scope of Work and extracting bill items..."
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function generate() {
      if (!sessionId) {
        setError("Missing payment session. Please start over.");
        return;
      }

      const boqType = localStorage.getItem("boq_type") ?? "generate";
      const isRateBoq = boqType === "rate_boq";

      let progressTimer: ReturnType<typeof setInterval> | null = null;

      try {
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
          setProgress((p) => (p < 94 ? p + 3 : p));
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          if (elapsed > 20) {
            setStatusText("Still working. Complex BOQs can take a bit longer...");
          } else if (elapsed > 8) {
            setStatusText(
              isRateBoq
                ? "Matching Zambian market rates to your items..."
                : "Classifying trades, quantities, and units..."
            );
          }
        }, 2000);

        setProgress(30);

        let res: Response;

        if (isRateBoq) {
          setStatusText("AI is parsing your BOQ and filling in rates...");
          const rateContextRaw = localStorage.getItem("boq_rate_context");
          const rateContext = rateContextRaw ? JSON.parse(rateContextRaw) : undefined;
          res = await fetch("/api/rate-boq", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, rate_context: rateContext }),
          });
        } else {
          const bundleRaw = localStorage.getItem("boq_document_bundle");
          const text = localStorage.getItem("boq_text");
          const documents = bundleRaw ? JSON.parse(bundleRaw) : null;
          if (!text && !documents?.length) {
            setError(
              "Your session expired. If you were charged, please contact us with your payment reference."
            );
            return;
          }
          const suggestRates = localStorage.getItem("boq_suggest_rates") === "1";
          const isSOW = localStorage.getItem("boq_is_sow") !== "0";
          const sowWarning = localStorage.getItem("boq_sow_warning") || null;
          const documentType = localStorage.getItem("boq_document_type") || null;
          const shouldBlockGeneration = localStorage.getItem("boq_should_block_generation") === "1";

          setStatusText("AI is reading your Scope of Work and extracting bill items...");
          res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              documents,
              session_id: sessionId,
              suggest_rates: suggestRates,
              is_sow: isSOW,
              sow_warning: sowWarning,
              document_type: documentType,
              should_block_generation: shouldBlockGeneration,
            }),
          });
        }

        setProgress(80);

        if (!res.ok) {
          let e: string | undefined;
          try {
            const body = await res.json();
            e = body.error;
          } catch { /* non-JSON error body (e.g. Vercel timeout HTML) */ }
          if (res.status === 402)
            throw new Error("Payment could not be verified. Please contact support.");
          if (res.status === 429)
            throw new Error("AI quota exceeded. Please try again in a minute.");
          if (res.status === 503)
            throw new Error("AI service is temporarily busy. Please wait a moment and try again.");
          if (res.status === 504 || !e)
            throw new Error("The request timed out. Your BOQ may be large — please try again.");
          throw new Error(e || (isRateBoq ? "Rate filling failed" : "BOQ generation failed"));
        }

        const { boq, boq_id } = await res.json();
        setProgress(100);

        ph.capture(isRateBoq ? "boq_rates_filled" : "boq_generated", {
          boq_id,
          bill_count: boq?.bills?.length ?? 0,
          item_count: (boq?.bills ?? []).reduce(
            (s: number, b: { items?: unknown[] }) => s + (b.items?.length ?? 0), 0
          ),
        });

        // Clean up localStorage
        localStorage.removeItem("boq_type");
        localStorage.removeItem("boq_text");
        localStorage.removeItem("boq_document_bundle");
        localStorage.removeItem("boq_suggest_rates");
        localStorage.removeItem("boq_is_sow");
        localStorage.removeItem("boq_sow_warning");
        localStorage.removeItem("boq_sow_confidence");
        localStorage.removeItem("boq_document_type");
        localStorage.removeItem("boq_should_block_generation");
        localStorage.removeItem("boq_positive_signals");
        localStorage.removeItem("boq_negative_signals");
        localStorage.removeItem("boq_sow_flags");
        localStorage.removeItem("boq_required_attachments");
        localStorage.removeItem("boq_source_bundle_status");
        localStorage.removeItem("boq_rate_context");

        if (boq_id) {
          router.push(`/boq/${boq_id}`);
        } else {
          sessionStorage.setItem("boq_data", JSON.stringify(boq));
          router.push("/boq");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setStatusText("Generation stopped due to an error.");
        setError(
          msg === "Failed to fetch"
            ? "Network error. Check your connection and try again."
            : msg
        );
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }

    generate();
  }, [sessionId, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md text-center">
        {error ? (
          <div className="space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
              <p className="text-gray-400 text-sm leading-relaxed">{error}</p>
            </div>
            <a
              href="/"
              className="inline-block px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors"
            >
              Start Over
            </a>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto animate-pulse">
              <svg
                className="w-8 h-8 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Generating your BOQ</h2>
              <p className="text-gray-400 text-sm">{statusText}</p>
            </div>
            <div className="space-y-2">
              <Progress value={progress} className="h-1.5 bg-white/10" />
              <p className="text-xs text-gray-500">This takes about 30–60 seconds</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function GeneratingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <div className="text-gray-400 text-sm">Loading…</div>
        </main>
      }
    >
      <GeneratingContent />
    </Suspense>
  );
}
