"use client";

import { useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import Footer from "@/components/Footer";

type Stage = "idle" | "extracting" | "ready" | "paying" | "error";

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [suggestRates, setSuggestRates] = useState(false);
  const [sowWarning, setSowWarning] = useState<string | null>(null);

  function handleFile(f: File) {
    const name = f.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
      setError("Please upload a PDF or Word (.docx) document.");
      return;
    }
    setFile(f);
    setStage("idle");
    setError(null);
    setPages(null);
    setSowWarning(null);
  }

  async function handleExtract() {
    if (!file) return;
    setError(null);
    setSowWarning(null);
    setStage("extracting");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Extraction failed");
      }
      const { text, pages: p, isSOW, sowWarning: warning } = await res.json();
      localStorage.setItem("boq_text", text);
      setPages(p);
      if (!isSOW && warning) {
        setSowWarning(warning);
      }
      setStage("ready");
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  async function handleCheckout() {
    if (!file) return;
    localStorage.setItem("boq_suggest_rates", suggestRates ? "1" : "0");
    setStage("paying");
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Could not create payment session");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  const isProcessing = stage === "extracting" || stage === "paying";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Nav */}
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

      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-xl animate-fade-up">
        {stage === "ready" || stage === "paying" ? (
          /* ── Pricing screen ── */
          <div className="text-center space-y-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight mb-3">
                BOQ <span className="text-amber-400">Generator</span>
              </h1>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-medium">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                {pages
                  ? `Document ready · ${pages} ${pages === 1 ? "page" : "pages"} extracted`
                  : "Document ready · text extracted"}
              </div>
            </div>

            {/* SOW warning */}
            {sowWarning && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-left">
                <svg className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-xs text-yellow-300 font-medium">Document may not be a Scope of Work</p>
                  <p className="text-xs text-yellow-400/80 mt-0.5">{sowWarning} You can still proceed, but the BOQ quality may be poor.</p>
                </div>
              </div>
            )}

            {/* File pill */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10 text-left">
              <div className="w-8 h-8 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
                <FileIcon className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-sm text-white truncate flex-1">{file?.name}</p>
              <button
                className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
                onClick={() => { setFile(null); setStage("idle"); setPages(null); setSowWarning(null); }}
              >
                Change
              </button>
            </div>

            {/* Pricing card */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-left space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white font-semibold text-lg">BOQ Generation</p>
                  <p className="text-gray-400 text-sm mt-0.5">One-time · instant delivery</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-amber-400">$100</p>
                  <p className="text-xs text-gray-500">USD</p>
                </div>
              </div>
              <ul className="space-y-2">
                {[
                  "Structured BOQ with bill sections",
                  "Editable table — adjust quantities & descriptions",
                  "Download .xlsx in Zambian tender format (ZMW)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                    <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Rate estimates toggle */}
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={suggestRates}
                  onChange={(e) => setSuggestRates(e.target.checked)}
                  disabled={stage === "paying"}
                />
                <div className="w-9 h-5 rounded-full border border-white/20 bg-white/5 peer-checked:bg-amber-400 peer-checked:border-amber-400 transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-400 peer-checked:bg-black peer-checked:translate-x-4 transition-all" />
              </div>
              <div>
                <p className="text-sm text-white font-medium group-has-[:checked]:text-amber-400 transition-colors">
                  Include AI rate estimates
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  AI suggests typical ZMW rates based on the Zambian construction market. Review and adjust before use.
                </p>
              </div>
            </label>

            <button
              className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              onClick={handleCheckout}
              disabled={stage === "paying"}
            >
              {stage === "paying" ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />
                  Opening secure checkout...
                </>
              ) : (
                "Pay $100 & Generate BOQ →"
              )}
            </button>

            <p className="text-xs text-gray-600">
              Secure payment via Stripe. You will be redirected back after payment.
            </p>

            {stage === "paying" && (
              <div className="space-y-2">
                <Progress value={92} className="h-1.5 bg-white/10" />
                <p className="text-xs text-gray-400">Redirecting to Stripe checkout...</p>
              </div>
            )}
          </div>
        ) : (
          /* ── Upload screen ── */
          <>
            <div className="text-center mb-10">
              <h1 className="text-4xl font-bold tracking-tight mb-3">
                BOQ <span className="text-amber-400">Generator</span>
              </h1>
              <p className="text-gray-400 text-base leading-relaxed">
                Upload a Scope of Work PDF or Word doc. Get a tender-ready
                <br />
                Bill of Quantities in under 60 seconds.
              </p>
            </div>

            {/* Upload zone */}
            <div
              className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
                ${dragging ? "border-amber-400 bg-amber-500/5" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"}
              `}
              onClick={() => !isProcessing && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />

              {file ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <FileIcon className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-white truncate max-w-xs">{file.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  {!isProcessing && (
                    <button
                      className="text-xs text-gray-500 hover:text-gray-300 underline mt-1"
                      onClick={(e) => { e.stopPropagation(); setFile(null); setStage("idle"); setError(null); setSowWarning(null); }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center">
                    <UploadIcon className="w-6 h-6 text-gray-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-white">Drop your SOW here</p>
                    <p className="text-xs text-gray-500 mt-1">PDF or Word (.docx) · max 15 MB</p>
                  </div>
                </div>
              )}
            </div>

            {isProcessing && (
              <div className="mt-6 space-y-2">
                <Progress value={stage === "extracting" ? 60 : 90} className="h-1.5 bg-white/10" />
                <p className="text-sm text-gray-400 text-center">
                  {stage === "extracting"
                    ? "Extracting text and validating document..."
                    : "Redirecting to payment..."}
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              className={`mt-6 w-full py-3 rounded-lg font-semibold text-sm transition-all
                ${file && !isProcessing
                  ? "bg-amber-400 hover:bg-amber-300 text-black cursor-pointer"
                  : "bg-white/5 text-gray-600 cursor-not-allowed"
                }`}
              disabled={!file || isProcessing}
              onClick={handleExtract}
            >
              {isProcessing ? (stage === "extracting" ? "Extracting…" : "Redirecting…") : "Continue →"}
            </button>

            <p className="mt-8 text-center text-xs text-gray-600">
              Supports civil, mechanical, and infrastructure SOW documents.
              <br />
              Output matches standard Zambian tender BOQ format (ZMW).
            </p>
          </>
        )}
      </div>

      <div className="w-full max-w-xl mt-16">
        <Footer />
      </div>
    </main>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
