"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Progress } from "@/components/ui/progress";

type Stage = "idle" | "extracting" | "generating" | "done" | "error";

const STAGES: Record<Stage, { label: string; pct: number }> = {
  idle: { label: "", pct: 0 },
  extracting: { label: "Extracting text from PDF…", pct: 25 },
  generating: { label: "Generating BOQ with AI…", pct: 65 },
  done: { label: "Done!", pct: 100 },
  error: { label: "", pct: 0 },
};

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    setFile(f);
    setError(null);
  }

  async function handleGenerate() {
    if (!file) return;
    setError(null);

    try {
      setStage("extracting");
      const form = new FormData();
      form.append("file", file);
      const extractRes = await fetch("/api/extract", { method: "POST", body: form });
      if (!extractRes.ok) {
        const { error: e } = await extractRes.json();
        throw new Error(e || "PDF extraction failed");
      }
      const { text } = await extractRes.json();

      setStage("generating");
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!genRes.ok) {
        const { error: e } = await genRes.json();
        throw new Error(e || "BOQ generation failed");
      }
      const { boq } = await genRes.json();

      setStage("done");
      sessionStorage.setItem("boq_data", JSON.stringify(boq));
      router.push("/boq");
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const isProcessing = stage === "extracting" || stage === "generating";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-xl animate-fade-up">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium mb-6">
            Powered by Claude AI
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">
            BOQ <span className="text-amber-400">Generator</span>
          </h1>
          <p className="text-gray-400 text-base leading-relaxed">
            Upload a Scope of Work PDF. Get a tender-ready
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
            accept=".pdf"
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
                  onClick={(e) => { e.stopPropagation(); setFile(null); setStage("idle"); setError(null); }}
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
                <p className="font-medium text-sm text-white">Drop your SOW PDF here</p>
                <p className="text-xs text-gray-500 mt-1">or click to browse · max 15 MB</p>
              </div>
            </div>
          )}
        </div>

        {isProcessing && (
          <div className="mt-6 space-y-2">
            <Progress value={STAGES[stage].pct} className="h-1.5 bg-white/10" />
            <p className="text-sm text-gray-400 text-center">{STAGES[stage].label}</p>
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
          onClick={handleGenerate}
        >
          {isProcessing ? STAGES[stage].label : "Generate BOQ →"}
        </button>

        <p className="mt-8 text-center text-xs text-gray-600">
          Supports civil, mechanical, and infrastructure SOW documents.
          <br />
          Output matches standard Zambian tender BOQ format (ZMW).
        </p>
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
