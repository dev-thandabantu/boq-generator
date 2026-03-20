"use client";

import { useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import Footer from "@/components/Footer";
import { usePostHog } from "posthog-js/react";

type Tab = "generate" | "rate";
type Stage = "idle" | "extracting" | "ready" | "paying" | "error";

// ─── Generate BOQ Tab ────────────────────────────────────────────────────────

function GenerateBOQTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [suggestRates, setSuggestRates] = useState(false);
  const [sowWarning, setSowWarning] = useState<string | null>(null);
  const [isSOW, setIsSOW] = useState<boolean | null>(null);
  const ph = usePostHog();

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
    setIsSOW(null);
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
      const {
        text, pages: p, isSOW: isSOWResult, sowWarning: warning,
        sowConfidence, documentType, sowFlags,
      } = await res.json();
      localStorage.setItem("boq_text", text);
      localStorage.setItem("boq_is_sow", isSOWResult ? "1" : "0");
      localStorage.setItem("boq_sow_warning", warning || "");
      localStorage.setItem("boq_sow_confidence", sowConfidence ? String(sowConfidence) : "");
      localStorage.setItem("boq_document_type", documentType || "");
      localStorage.setItem("boq_sow_flags", JSON.stringify(sowFlags || []));
      setPages(p);
      setIsSOW(isSOWResult);
      ph.capture("document_uploaded", {
        file_type: file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
        pages: p, is_sow: isSOWResult,
      });
      if (!isSOWResult && warning) {
        setSowWarning(warning);
        ph.capture("sow_warning_shown", { reason: warning, document_type: documentType, confidence: sowConfidence });
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
    if (isSOW === false) {
      setError("This document does not appear to be a construction Scope of Work suitable for BOQ generation.");
      return;
    }
    localStorage.setItem("boq_suggest_rates", suggestRates ? "1" : "0");
    localStorage.setItem("boq_type", "generate");
    ph.capture("payment_initiated", { suggest_rates: suggestRates });
    setStage("paying");
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: "generate_boq" }),
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

  if (stage === "ready" || stage === "paying") {
    return (
      <div className="text-center space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-3">Your document is ready</h2>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            {pages ? `${pages} ${pages === 1 ? "page" : "pages"} extracted` : "Text extracted"}
          </div>
        </div>

        {sowWarning && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-left">
            <svg className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-xs text-yellow-300 font-medium">Document may not be a Scope of Work</p>
              <p className="text-xs text-yellow-200/90 mt-0.5">{sowWarning} Please upload a construction SOW, BOQ, or engineering specification instead.</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10 text-left">
          <div className="w-8 h-8 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
            <FileIcon className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-sm text-white truncate flex-1">{file?.name}</p>
          <button className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
            onClick={() => { setFile(null); setStage("idle"); setPages(null); setSowWarning(null); setIsSOW(null); }}>
            Change
          </button>
        </div>

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

        <label className="flex items-start gap-3 cursor-pointer select-none group">
          <div className="relative mt-0.5 shrink-0">
            <input type="checkbox" className="sr-only peer" checked={suggestRates}
              onChange={(e) => setSuggestRates(e.target.checked)} disabled={stage === "paying"} />
            <div className="w-9 h-5 rounded-full border border-white/20 bg-white/5 peer-checked:bg-amber-400 peer-checked:border-amber-400 transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-400 peer-checked:bg-black peer-checked:translate-x-4 transition-all" />
          </div>
          <div>
            <p className="text-sm text-white font-medium group-has-[:checked]:text-amber-400 transition-colors">Include AI rate estimates</p>
            <p className="text-xs text-gray-500 mt-0.5">AI suggests typical ZMW rates based on the Zambian construction market. Review and adjust before use.</p>
          </div>
        </label>

        <button
          className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={handleCheckout} disabled={stage === "paying" || isSOW === false}>
          {stage === "paying" ? (
            <><span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />Opening secure checkout...</>
          ) : isSOW === false ? "Upload a construction SOW to continue" : "Pay $100 & Generate BOQ →"}
        </button>

        <p className="text-xs text-gray-600">Secure payment via Stripe. You will be redirected back after payment.</p>

        {stage === "paying" && (
          <div className="space-y-2">
            <Progress value={92} className="h-1.5 bg-white/10" />
            <p className="text-xs text-gray-400">Redirecting to Stripe checkout...</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <p className="text-gray-400 text-sm leading-relaxed">
          Upload a Scope of Work PDF or Word doc. Get a tender-ready
          <br />Bill of Quantities in under 60 seconds.
        </p>
      </div>

      <div
        className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
          ${dragging ? "border-amber-400 bg-amber-500/5" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"}`}
        onClick={() => !isProcessing && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
        <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

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
              <button className="text-xs text-gray-500 hover:text-gray-300 underline mt-1"
                onClick={(e) => { e.stopPropagation(); setFile(null); setStage("idle"); setError(null); setSowWarning(null); }}>
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
            {stage === "extracting" ? "Extracting text and validating document..." : "Redirecting to payment..."}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      <button
        className={`mt-6 w-full py-3 rounded-lg font-semibold text-sm transition-all
          ${file && !isProcessing ? "bg-amber-400 hover:bg-amber-300 text-black cursor-pointer" : "bg-white/5 text-gray-600 cursor-not-allowed"}`}
        disabled={!file || isProcessing} onClick={handleExtract}>
        {isProcessing ? (stage === "extracting" ? "Extracting…" : "Redirecting…") : "Continue →"}
      </button>

      <p className="mt-8 text-center text-xs text-gray-600">
        Supports civil, mechanical, and infrastructure SOW documents.
        <br />Output matches standard Zambian tender BOQ format (ZMW).
      </p>
    </>
  );
}

// ─── Rate Existing BOQ Tab ───────────────────────────────────────────────────

type RateStage = "idle" | "validating" | "questions" | "ready" | "paying" | "error";

interface BOQPreview {
  totalItems: number;
  missingRateCount: number;
  rateColumnHeader: string | null;
  amountColumnHeader: string | null;
}

interface RateContext {
  province: string;
  accessibility: string;
  labourSource: string;
  equipment: string;
  marginPct: number;
}

const PROVINCES = [
  "Lusaka", "Copperbelt", "Southern", "Eastern", "Northern",
  "Western", "Luapula", "North-Western", "Muchinga", "Central",
];

const DEFAULT_CONTEXT: RateContext = {
  province: "Lusaka",
  accessibility: "main_road",
  labourSource: "mixed",
  equipment: "contractor_owned",
  marginPct: 15,
};

function RateBOQTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<RateStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<BOQPreview | null>(null);
  const [ctx, setCtx] = useState<RateContext>(DEFAULT_CONTEXT);
  const [customMargin, setCustomMargin] = useState(false);
  const ph = usePostHog();

  function handleFile(f: File) {
    const name = f.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      setError("Please upload an Excel file (.xlsx or .xls).");
      return;
    }
    setFile(f);
    setStage("idle");
    setError(null);
    setStorageKey(null);
    setPreview(null);
  }

  async function handleValidate() {
    if (!file) return;
    setError(null);
    setStage("validating");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest-boq", { method: "POST", body: form });
      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Validation failed");
      }
      const { storageKey: key, preview: p } = await res.json();
      setStorageKey(key);
      setPreview(p);
      ph.capture("excel_boq_uploaded", {
        total_items: p.totalItems,
        missing_rate_count: p.missingRateCount,
      });
      setStage("questions");
    } catch (err) {
      setStage("error");
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg === "Failed to fetch" ? "Network error. Check your connection and try again." : msg);
    }
  }

  function handleQuestionsSubmit() {
    localStorage.setItem("boq_rate_context", JSON.stringify(ctx));
    setStage("ready");
  }

  async function handleCheckout() {
    if (!storageKey || !preview) return;
    localStorage.setItem("boq_type", "rate_boq");
    localStorage.setItem("boq_rate_context", JSON.stringify(ctx));
    ph.capture("payment_initiated", { type: "rate_boq", province: ctx.province });
    setStage("paying");
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "rate_boq",
          storageKey,
          rateColHeader: preview.rateColumnHeader ?? "",
          amountColHeader: preview.amountColumnHeader ?? "",
        }),
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

  const isProcessing = stage === "validating" || stage === "paying";

  // ── Questions form ──────────────────────────────────────────────────────────
  if (stage === "questions") {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-medium mb-3">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            {preview?.totalItems} items · {preview?.missingRateCount} missing rates
          </div>
          <h2 className="text-xl font-bold text-white">Tell us about the project</h2>
          <p className="text-xs text-gray-400 mt-1">
            These 5 questions help the AI calibrate rates to your actual site conditions.
          </p>
        </div>

        <div className="space-y-4">
          {/* Q1 Province */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-medium text-white">1. Which province is the project in?</p>
            <div className="flex flex-wrap gap-2">
              {PROVINCES.map((p) => (
                <button key={p}
                  onClick={() => setCtx((c) => ({ ...c, province: p }))}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    ctx.province === p
                      ? "bg-amber-400 text-black"
                      : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Q2 Site accessibility */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-medium text-white">2. How accessible is the site?</p>
            <p className="text-xs text-gray-500">This affects transport premiums on materials.</p>
            <div className="space-y-2 mt-1">
              {[
                { val: "main_road", label: "Main road access", sub: "Standard transport costs" },
                { val: "gravel_road", label: "Gravel / secondary road", sub: "+10–20% transport premium" },
                { val: "remote", label: "Remote or bush site", sub: "+25–40% transport premium" },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setCtx((c) => ({ ...c, accessibility: val }))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                    ctx.accessibility === val
                      ? "bg-amber-400/15 border border-amber-400/40"
                      : "bg-white/5 border border-white/10 hover:bg-white/10"
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${ctx.accessibility === val ? "border-amber-400 bg-amber-400" : "border-gray-500"}`} />
                  <span>
                    <span className="text-sm text-white block">{label}</span>
                    <span className="text-xs text-gray-400">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Q3 Labour */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-medium text-white">3. What&apos;s the expected labour source?</p>
            <div className="space-y-2 mt-1">
              {[
                { val: "local_unskilled", label: "Mostly local unskilled labour", sub: "Lower labour rates, minimal mobilisation" },
                { val: "mixed", label: "Mix of skilled & unskilled", sub: "Mid-range rates — most common scenario" },
                { val: "imported_skilled", label: "Mostly imported / specialist trades", sub: "Higher rates + accommodation & mobilisation" },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setCtx((c) => ({ ...c, labourSource: val }))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                    ctx.labourSource === val
                      ? "bg-amber-400/15 border border-amber-400/40"
                      : "bg-white/5 border border-white/10 hover:bg-white/10"
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${ctx.labourSource === val ? "border-amber-400 bg-amber-400" : "border-gray-500"}`} />
                  <span>
                    <span className="text-sm text-white block">{label}</span>
                    <span className="text-xs text-gray-400">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Q4 Equipment */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-medium text-white">4. How will plant & equipment be sourced?</p>
            <div className="space-y-2 mt-1">
              {[
                { val: "contractor_owned", label: "Contractor owns most equipment", sub: "No external hire premium" },
                { val: "mostly_hired", label: "Mostly hired in", sub: "Include plant hire margin in rates" },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setCtx((c) => ({ ...c, equipment: val }))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                    ctx.equipment === val
                      ? "bg-amber-400/15 border border-amber-400/40"
                      : "bg-white/5 border border-white/10 hover:bg-white/10"
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${ctx.equipment === val ? "border-amber-400 bg-amber-400" : "border-gray-500"}`} />
                  <span>
                    <span className="text-sm text-white block">{label}</span>
                    <span className="text-xs text-gray-400">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Q5 Margin */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-medium text-white">5. Target overhead & profit margin</p>
            <p className="text-xs text-gray-500">Applied on top of base construction rates.</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {[10, 15, 20].map((pct) => (
                <button key={pct}
                  onClick={() => { setCtx((c) => ({ ...c, marginPct: pct })); setCustomMargin(false); }}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    ctx.marginPct === pct && !customMargin
                      ? "bg-amber-400 text-black"
                      : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}>
                  {pct}%
                </button>
              ))}
              <button
                onClick={() => setCustomMargin(true)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  customMargin ? "bg-amber-400 text-black" : "bg-white/10 text-gray-300 hover:bg-white/15"
                }`}>
                Custom
              </button>
            </div>
            {customMargin && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min={1} max={50}
                  value={ctx.marginPct}
                  onChange={(e) => setCtx((c) => ({ ...c, marginPct: Math.min(50, Math.max(1, Number(e.target.value) || 15)) }))}
                  className="w-20 px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-sm text-center focus:outline-none focus:border-amber-400/60"
                />
                <span className="text-sm text-gray-400">% margin</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleQuestionsSubmit}
          className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors">
          Continue to payment →
        </button>
      </div>
    );
  }

  // ── Payment screen ──────────────────────────────────────────────────────────
  if (stage === "ready" || stage === "paying") {
    return (
      <div className="text-center space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-3">Ready to rate</h2>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            {preview?.totalItems} items · {preview?.missingRateCount} missing rates · {ctx.province} · {ctx.marginPct}% margin
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10 text-left">
          <div className="w-8 h-8 rounded bg-green-500/20 flex items-center justify-center shrink-0">
            <ExcelIcon className="w-4 h-4 text-green-400" />
          </div>
          <p className="text-sm text-white truncate flex-1">{file?.name}</p>
          <button className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
            onClick={() => { setStage("questions"); }}>
            Edit answers
          </button>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-left space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white font-semibold text-lg">BOQ Rate Filling</p>
              <p className="text-gray-400 text-sm mt-0.5">One-time · instant delivery</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-amber-400">$100</p>
              <p className="text-xs text-gray-500">USD</p>
            </div>
          </div>
          <ul className="space-y-2">
            {[
              `AI fills rates for ${preview?.missingRateCount} items calibrated to ${ctx.province} conditions`,
              "Download your original Excel file with rates added in-place",
              "Or download a freshly formatted BOQ in our house style",
              "Editable in the BOQ editor — review and adjust before exporting",
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

        <button
          className="w-full py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          onClick={handleCheckout} disabled={stage === "paying"}>
          {stage === "paying" ? (
            <><span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black/60 border-t-transparent animate-spin" />Opening secure checkout...</>
          ) : "Pay $100 & Add Rates →"}
        </button>

        <p className="text-xs text-gray-600">Secure payment via Stripe. You will be redirected back after payment.</p>

        {stage === "paying" && (
          <div className="space-y-2">
            <Progress value={92} className="h-1.5 bg-white/10" />
            <p className="text-xs text-gray-400">Redirecting to Stripe checkout...</p>
          </div>
        )}
      </div>
    );
  }

  // ── Upload screen ───────────────────────────────────────────────────────────
  return (
    <>
      <div className="text-center mb-8">
        <p className="text-gray-400 text-sm leading-relaxed">
          Upload an Excel BOQ that&apos;s missing rates.
          <br />AI fills rates using Zambian construction market prices.
        </p>
      </div>

      <div
        className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
          ${dragging ? "border-amber-400 bg-amber-500/5" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"}`}
        onClick={() => !isProcessing && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
              <ExcelIcon className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="font-medium text-sm text-white truncate max-w-xs">{file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            {!isProcessing && (
              <button className="text-xs text-gray-500 hover:text-gray-300 underline mt-1"
                onClick={(e) => { e.stopPropagation(); setFile(null); setStage("idle"); setError(null); }}>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center">
              <ExcelIcon className="w-6 h-6 text-gray-400" />
            </div>
            <div>
              <p className="font-medium text-sm text-white">Drop your BOQ here</p>
              <p className="text-xs text-gray-500 mt-1">Excel (.xlsx or .xls) · max 50 MB</p>
            </div>
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="mt-6 space-y-2">
          <Progress value={stage === "validating" ? 60 : 90} className="h-1.5 bg-white/10" />
          <p className="text-sm text-gray-400 text-center">
            {stage === "validating" ? "Validating your BOQ structure..." : "Redirecting to payment..."}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      <button
        className={`mt-6 w-full py-3 rounded-lg font-semibold text-sm transition-all
          ${file && !isProcessing ? "bg-amber-400 hover:bg-amber-300 text-black cursor-pointer" : "bg-white/5 text-gray-600 cursor-not-allowed"}`}
        disabled={!file || isProcessing} onClick={handleValidate}>
        {isProcessing ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-black/40 border-t-transparent animate-spin" />
            Validating…
          </span>
        ) : "Validate & Continue →"}
      </button>

      <p className="mt-8 text-center text-xs text-gray-600">
        Works with any BOQ structure. Items, quantities, and descriptions are preserved verbatim.
        <br />Rates are calibrated to your site location, labour, and margin.
      </p>
    </>
  );
}

// ─── Main Upload Page ────────────────────────────────────────────────────────

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<Tab>("generate");

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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-3">
            BOQ <span className="text-amber-400">Generator</span>
          </h1>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-white/10 bg-white/[0.02] p-1 mb-8">
          <button
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              activeTab === "generate"
                ? "bg-amber-400 text-black"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => setActiveTab("generate")}>
            Generate BOQ from SoW
          </button>
          <button
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              activeTab === "rate"
                ? "bg-amber-400 text-black"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => setActiveTab("rate")}>
            Rate an Existing BOQ
          </button>
        </div>

        {activeTab === "generate" ? <GenerateBOQTab /> : <RateBOQTab />}
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

function ExcelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m13.5-1.5v1.5c0 .621-.504 1.125-1.125 1.125m-13.5 0h7.5" />
    </svg>
  );
}
