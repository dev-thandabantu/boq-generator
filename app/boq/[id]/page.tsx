"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";

import type { BOQBill, BOQDocument, BOQItem, BOQQualityScore, BOQQualitySummary } from "@/lib/types";
import { usePostHog } from "posthog-js/react";
import { computeDeterministicQA } from "@/lib/boq-qa";

interface DBBoq {
  id: string;
  title: string;
  data: BOQDocument;
  source_excel_key?: string | null;
}

interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

interface AssistantDiff {
  billDelta: number;
  itemDelta: number;
  pricedItemsDelta: number;
}

interface AssistantPreview {
  summary: string;
  proposedBoq: BOQDocument;
  diff: AssistantDiff;
}

function unresolvedPlaceholder(item: BOQItem): string | null {
  if (item.note === "Incl") return "Incl";
  if (item.qty === null && item.rate === null) return "TO BE COMPLETED";
  return null;
}

function getSourceUsage(boq: BOQDocument) {
  const counts = new Map<string, number>();
  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      const key = item.source_document || "primary-or-unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

export default function BOQPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [boq, setBOQ] = useState<BOQDocument | null>(null);
  const [boqId] = useState(id);
  const ph = usePostHog();
  const [exporting, setExporting] = useState(false);
  const [exportingPatched, setExportingPatched] = useState(false);
  const [hasSourceExcel, setHasSourceExcel] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [qa, setQA] = useState<BOQQualityScore | null>(null);
  const [qaLoading, setQALoading] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantPaneOpen, setAssistantPaneOpen] = useState(true);
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);
  const [assistantPreview, setAssistantPreview] = useState<AssistantPreview | null>(null);
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content:
        "Describe the BOQ change you want, and I will apply it directly to this BOQ only.",
    },
  ]);
  const undoStack = useRef<BOQDocument[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/boqs/${id}`);
      if (!res.ok) {
        router.replace("/dashboard");
        return;
      }
      const { boq: row }: { boq: DBBoq } = await res.json();
      setBOQ(row.data);
      setHasSourceExcel(Boolean(row.source_excel_key));
      setQA(row.data.qa ?? computeDeterministicQA(row.data));
      setLoading(false);

      // Load QA score — use cached if present, otherwise fetch
      if (row.data.qa) {
        setQA(row.data.qa);
      } else {
        setQALoading(true);
        fetch(`/api/boqs/${id}/qa`, { method: "POST" })
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => {
            if (json?.qa) setQA(json.qa);
          })
          .finally(() => setQALoading(false));
      }
    }
    load();
  }, [id, router]);

  const saveToDB = useCallback(
    (updated: BOQDocument) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await fetch(`/api/boqs/${boqId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: updated.project || "Untitled BOQ", data: updated }),
        });
        setSaved(true);
      }, 1200);
    },
    [boqId]
  );

  const updateBOQ = useCallback(
    (updated: BOQDocument) => {
      setBOQ(updated);
      setQA(computeDeterministicQA(updated));
      setSaved(false);
      saveToDB(updated);
    },
    [saveToDB]
  );

  function updateItem(
    billIdx: number,
    itemIdx: number,
    field: keyof BOQItem,
    value: string | number | null
  ) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      const items = b.items.map((it, ii) => {
        if (ii !== itemIdx) return it;
        const updated = { ...it, [field]: value };
        if (updated.qty !== null && updated.rate !== null) {
          updated.amount = +(updated.qty * updated.rate).toFixed(2);
        }
        return updated;
      });
      return { ...b, items };
    });
    updateBOQ({ ...boq, bills });
  }

  function addItem(billIdx: number) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      const newItem: BOQItem = {
        item_no: "",
        description: "",
        unit: "Item",
        qty: null,
        rate: null,
        amount: null,
        quantity_source: "assumed",
        quantity_confidence: 0.4,
      };
      return { ...b, items: [...b.items, newItem] };
    });
    updateBOQ({ ...boq, bills });
  }

  function removeItem(billIdx: number, itemIdx: number) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      return { ...b, items: b.items.filter((_, ii) => ii !== itemIdx) };
    });
    updateBOQ({ ...boq, bills });
  }

  async function handleExport() {
    if (!boq) return;

    const summary = getQualitySummary(boq);
    if (summary.qty_missing > 0 || summary.low_confidence > 0) {
      const proceed = window.confirm(
        `There are ${summary.qty_missing} unresolved quantities and ${summary.low_confidence} low-confidence items. Export anyway?`
      );
      if (!proceed) return;
    }

    ph.capture("excel_downloaded", {
      boq_id: boqId,
      bill_count: boq.bills.length,
      item_count: boq.bills.reduce((s, b) => s + b.items.filter((i) => !i.is_header).length, 0),
    });
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(boq),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOQ_${boq.project.replace(/[^\w]/g, "_").slice(0, 40)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExporting(false);
      setExportDropdownOpen(false);
    }
  }

  async function handleExportPatched() {
    setExportingPatched(true);
    setExportDropdownOpen(false);
    try {
      const res = await fetch(`/api/export-patched/${boqId}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rated_${boq?.project?.replace(/[^\w]/g, "_").slice(0, 40) ?? "BOQ"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExportingPatched(false);
    }
  }

  async function handleAssistantSubmit() {
    if (!boq || assistantBusy) return;

    const instruction = assistantInput.trim();
    if (!instruction) return;

    ph.capture("assistant_used", { boq_id: boqId });
    setAssistantInput("");
    setAssistantPreview(null);
    setAssistantMessages((prev) => [...prev, { role: "user", content: instruction }]);
    setAssistantBusy(true);
    setAssistantStatus("Planning edits...");

    let assistantDraft = "";
    let receivedProposal = false;
    setAssistantMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/boqs/${boqId}/assistant/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, boq }),
      });

      if (!res.ok) {
        const { error: e } = await res.json();
        throw new Error(e || "Assistant request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming is not available");

      const decoder = new TextDecoder();
      let buffer = "";

      function updateDraft() {
        setAssistantMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx < 0) return prev;
          if (next[lastIdx].role !== "assistant") return prev;
          next[lastIdx] = { role: "assistant", content: assistantDraft };
          return next;
        });
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const lines = evt.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim()) as {
            token?: string;
            step?: string;
            summary?: string;
            proposed_boq?: BOQDocument;
            diff?: AssistantDiff;
            message?: string;
          };

          if (eventType === "status") {
            if (payload.step === "planning") setAssistantStatus("Thinking through your request...");
            if (payload.step === "proposing")
              setAssistantStatus("Building BOQ proposal for your review...");
          }

          if (eventType === "token" && payload.token) {
            assistantDraft += payload.token;
            updateDraft();
          }

          if (eventType === "result" && payload.proposed_boq && payload.diff) {
            receivedProposal = true;
            const summary = payload.summary || "Prepared BOQ edits for your review.";
            if (!assistantDraft.trim()) {
              assistantDraft = summary;
              updateDraft();
            }

            setAssistantPreview({
              summary,
              proposedBoq: payload.proposed_boq,
              diff: payload.diff,
            });
          }

          if (eventType === "error") {
            throw new Error(payload.message || "Assistant request failed");
          }
        }
      }

      if (!receivedProposal && !assistantDraft.trim()) {
        throw new Error("Assistant did not return a proposal. Please try again.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assistant failed";
      setAssistantMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      setAssistantBusy(false);
      setAssistantStatus(null);
    }
  }

  function handleApplyPreview() {
    if (!boq || !assistantPreview) return;
    undoStack.current.push(boq);
    setUndoCount(undoStack.current.length);
    updateBOQ(assistantPreview.proposedBoq);
    setAssistantMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Applied proposed BOQ changes.",
      },
    ]);
    setAssistantPreview(null);
  }

  function handleUndoLastAIEdit() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setUndoCount(undoStack.current.length);
    updateBOQ(previous);
    setAssistantMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Reverted the last AI-applied BOQ changes." },
    ]);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0c0f] animate-pulse">
        {/* Header skeleton */}
        <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0c0f]/95 px-4 py-3">
          <div className="max-w-[1500px] mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-7 w-28 rounded bg-white/10" />
              <div className="h-5 w-16 rounded-full bg-white/10" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-24 rounded-lg bg-white/10" />
              <div className="h-8 w-20 rounded-lg bg-white/10" />
            </div>
          </div>
        </div>
        {/* Table skeleton */}
        <div className="max-w-[1500px] mx-auto px-4 py-6 space-y-3">
          <div className="h-6 w-48 rounded bg-white/10" />
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {[100, 60, 80, 45, 70, 55].map((w, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="h-4 rounded bg-white/10" style={{ width: `${w}%` }} />
                <div className="h-4 w-16 rounded bg-white/10 shrink-0" />
                <div className="h-4 w-20 rounded bg-white/10 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!boq) return null;

  const qualitySummary = getQualitySummary(boq);
  const hasQuantityIssues = qualitySummary.qty_missing > 0 || qualitySummary.low_confidence > 0;

  const grandTotal = boq.bills.reduce((sum, b) => {
    const billTotal = b.items.reduce((s, it) => {
      if (it.is_header) return s;
      const amt = it.amount ?? (it.qty !== null && it.rate !== null ? it.qty * it.rate : null);
      return amt !== null ? s + amt : s;
    }, 0);
    return sum + billTotal;
  }, 0);

  return (
    <div className="min-h-screen bg-[#0b0c0f]">
      <header className="sticky top-0 z-20 border-b border-white/15 bg-[#0b0c0f]/95 backdrop-blur">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-gray-300 hover:text-white text-sm shrink-0"
            >
              ← Dashboard
            </button>
            <div className="min-w-0">
              <p className="text-xs text-gray-300 truncate">{boq.location}</p>
              <h1 className="text-sm font-semibold text-white truncate">{boq.project}</h1>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 sm:gap-3 shrink-0 flex-wrap">
            {!saved && <span className="text-xs text-gray-300 hidden sm:block">Saving…</span>}
            {grandTotal > 0 && (
              <span className="hidden md:block text-xs text-gray-200">
                Total:{" "}
                <span className="text-amber-300 font-mono">
                  ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                </span>
              </span>
            )}
            {qaLoading && (
              <span className="hidden md:flex items-center gap-1.5 text-xs text-gray-200">
                <span className="w-3 h-3 rounded-full border border-gray-600 border-t-transparent animate-spin inline-block" />
                Scoring BOQ…
              </span>
            )}
            {qa && <QABadge qa={qa} />}
            {hasSourceExcel ? (
              <div className="relative">
                <button
                  onClick={() => setExportDropdownOpen((v) => !v)}
                  disabled={exporting || exportingPatched}
                  className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  {exporting || exportingPatched ? "Exporting…" : "Download Excel"}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {exportDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl z-50">
                    <button
                      onClick={handleExportPatched}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/5 rounded-t-lg"
                    >
                      <p className="font-medium">Download original with rates</p>
                      <p className="text-xs text-gray-400 mt-0.5">Your uploaded Excel file, with rates filled in</p>
                    </button>
                    <div className="border-t border-white/5" />
                    <button
                      onClick={handleExport}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/5 rounded-b-lg"
                    >
                      <p className="font-medium">Download formatted BOQ</p>
                      <p className="text-xs text-gray-400 mt-0.5">Fresh export in our house style (ZMW)</p>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {exporting ? "Exporting…" : "Download Excel"}
              </button>
            )}
            <button
              onClick={() => setAssistantPaneOpen((v) => !v)}
              className="hidden xl:inline-flex px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              {assistantPaneOpen ? "Hide assistant" : "Show assistant"}
            </button>
            <button
              onClick={() => setAssistantDrawerOpen(true)}
              className="xl:hidden px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              Assistant
            </button>
          </div>
        </div>

        <div className="max-w-[1500px] mx-auto px-4 pb-2 flex flex-wrap gap-4 text-xs text-gray-300">
          <MetaField
            label="Project"
            value={boq.project}
            onChange={(v) => updateBOQ({ ...boq, project: v })}
          />
          <MetaField
            label="Location"
            value={boq.location}
            onChange={(v) => updateBOQ({ ...boq, location: v })}
          />
          <MetaField
            label="Prepared by"
            value={boq.prepared_by}
            onChange={(v) => updateBOQ({ ...boq, prepared_by: v })}
          />
          <MetaField label="Date" value={boq.date} onChange={(v) => updateBOQ({ ...boq, date: v })} />
        </div>
      </header>

     
      <main className="max-w-[1500px] mx-auto px-2 sm:px-4 py-6 space-y-4">
        {!assistantPaneOpen && (
          <div className="hidden xl:flex justify-end">
            <button
              onClick={() => setAssistantPaneOpen(true)}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-gray-100 text-sm"
            >
              Open assistant pane
            </button>
          </div>
        )}

        <div
          className={`grid gap-4 ${
            assistantPaneOpen ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px]" : "grid-cols-1"
          }`}
        >
          <div className="space-y-6 min-w-0">
            {hasQuantityIssues && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-500/12 p-4 text-sm">
                <p className="text-amber-200 font-semibold">Quantity Issues</p>
                <p className="text-amber-50 mt-1">
                  {qualitySummary.qty_missing} unresolved quantities, {qualitySummary.low_confidence}{" "}
                  low-confidence items. Export is allowed, but review these lines first.
                </p>
              </div>
            )}

            {process.env.NODE_ENV !== "production" && (
              <div className="rounded-xl border border-sky-400/30 bg-sky-500/[0.08] p-4 text-sm space-y-3">
                <div>
                  <p className="text-sky-200 font-semibold">Source Debug</p>
                  <p className="text-sky-50 mt-1">
                    Bundle status: {boq.quality_summary?.source_bundle_status ?? boq.document_classification?.source_bundle_status ?? "unknown"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {(boq.source_bundle ?? []).map((doc) => (
                    <span key={doc.document_id} className="rounded bg-white/10 px-2 py-1 text-gray-100">
                      {doc.document_id} · {doc.role} · {doc.document_type} · {doc.name}
                    </span>
                  ))}
                </div>
                <div className="space-y-1">
                  {getSourceUsage(boq).map(([source, count]) => (
                    <p key={source} className="text-[11px] text-gray-100">
                      {source}: {count} item{count === 1 ? "" : "s"}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {boq.bills.map((bill, billIdx) => (
              <BillSection
                key={billIdx}
                bill={bill}
                billIdx={billIdx}
                onUpdateItem={(itemIdx, field, value) =>
                  updateItem(billIdx, itemIdx, field, value)
                }
                onAddItem={() => addItem(billIdx)}
                onRemoveItem={(itemIdx) => removeItem(billIdx, itemIdx)}
              />
            ))}

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex justify-between items-center">
              <span className="font-bold text-white">TOTAL (VAT EXCLUSIVE)</span>
              <span className="font-mono font-bold text-amber-400 text-lg">
                ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {assistantPaneOpen && (
            <aside className="hidden xl:block">
              <div className="sticky top-22 pb-4">
                <AssistantPanel
                  assistantBusy={assistantBusy}
                  assistantStatus={assistantStatus}
                  undoCount={undoCount}
                  assistantMessages={assistantMessages}
                  assistantInput={assistantInput}
                  assistantPreview={assistantPreview}
                  onUndo={handleUndoLastAIEdit}
                  onPickPrompt={setAssistantInput}
                  onDiscardPreview={() => setAssistantPreview(null)}
                  onApplyPreview={handleApplyPreview}
                  onSubmit={handleAssistantSubmit}
                  onInputChange={setAssistantInput}
                />
              </div>
            </aside>
          )}
        </div>

        {assistantDrawerOpen && (
          <div className="xl:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-y-0 right-0 w-full max-w-md bg-[#13100c] border-l border-amber-400/35 p-3 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-amber-200">BOQ Assistant</h3>
                <button
                  onClick={() => setAssistantDrawerOpen(false)}
                  className="px-2 py-1 rounded-md bg-white/10 text-gray-100 text-xs"
                >
                  Close
                </button>
              </div>
              <AssistantPanel
                assistantBusy={assistantBusy}
                assistantStatus={assistantStatus}
                undoCount={undoCount}
                assistantMessages={assistantMessages}
                assistantInput={assistantInput}
                assistantPreview={assistantPreview}
                onUndo={handleUndoLastAIEdit}
                onPickPrompt={setAssistantInput}
                onDiscardPreview={() => setAssistantPreview(null)}
                onApplyPreview={handleApplyPreview}
                onSubmit={handleAssistantSubmit}
                onInputChange={setAssistantInput}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getQualitySummary(boq: BOQDocument): BOQQualitySummary {
  let total = 0;
  let qtyWithEvidence = 0;
  let qtyMissing = 0;
  let lowConfidence = 0;

  for (const bill of boq.bills) {
    for (const item of bill.items) {
      if (item.is_header) continue;
      total += 1;
      if (item.qty == null) qtyMissing += 1;
      if (item.qty != null && item.source_excerpt && item.source_excerpt.trim().length >= 12) {
        qtyWithEvidence += 1;
      }
      if ((item.quantity_confidence ?? 0.4) < 0.6) lowConfidence += 1;
    }
  }

  return {
    total_items: total,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
  };
}

function AssistantPanel({
  assistantBusy,
  assistantStatus,
  undoCount,
  assistantMessages,
  assistantInput,
  assistantPreview,
  onUndo,
  onPickPrompt,
  onDiscardPreview,
  onApplyPreview,
  onSubmit,
  onInputChange,
}: {
  assistantBusy: boolean;
  assistantStatus: string | null;
  undoCount: number;
  assistantMessages: AssistantMessage[];
  assistantInput: string;
  assistantPreview: AssistantPreview | null;
  onUndo: () => void;
  onPickPrompt: (value: string) => void;
  onDiscardPreview: () => void;
  onApplyPreview: () => void;
  onSubmit: () => void;
  onInputChange: (value: string) => void;
}) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const hasUserMessages = assistantMessages.some((message) => message.role === "user");
  const showWelcome = !hasUserMessages && !assistantPreview && !assistantBusy;

  function displayMessage(content: string) {
    return content
      .replace(/\s\*\s/g, "\n• ")
      .replace(/\*\s/g, "• ");
  }

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [assistantMessages, assistantStatus]);

  const quickPrompts = [
    "Add sample rates and amounts to all measurable items.",
    "Regroup electrical items into a separate bill.",
    "Rewrite item descriptions to be concise and technical.",
  ];

  return (
    <section className="rounded-xl border border-amber-400/35 bg-[#17130e] h-[calc(100dvh-9rem)] max-h-[calc(100dvh-9rem)] min-h-[520px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-400/30 bg-[#1b1711]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-100">AI BOQ Assistant</h2>
            <p className="text-[11px] text-gray-100 mt-0.5">
              BOQ-only edits. Generate proposal, review diff, then apply.
            </p>
          </div>
          <button
            onClick={onUndo}
            disabled={undoCount === 0 || assistantBusy}
            className="px-2.5 py-1 rounded-md text-[11px] bg-white/10 hover:bg-white/15 text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo ({undoCount})
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {showWelcome ? (
          <div className="rounded-lg border border-white/25 bg-white/[0.06] p-3 space-y-3">
            <p className="text-xs text-white leading-relaxed">
              Tell me what to change in this BOQ and I will generate a safe proposal first.
            </p>
            <div className={`grid gap-2 transition-opacity ${assistantBusy ? "opacity-40 pointer-events-none" : ""}`}>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onPickPrompt(prompt)}
                  disabled={assistantBusy}
                  className="text-left px-2.5 py-2 rounded-md bg-white/15 hover:bg-white/25 text-[11px] text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-[280px] rounded-lg border border-white/20 bg-[#0e0d0a] overflow-hidden">
            <div ref={threadRef} className="h-full overflow-y-auto p-2.5 space-y-2">
              {assistantMessages.map((message, idx) => (
                <div
                  key={idx}
                  className={`max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    message.role === "user"
                      ? "ml-auto bg-white/16 text-white border border-white/30"
                      : "mr-auto bg-amber-500/16 text-amber-50 border border-amber-400/35"
                  }`}
                >
                  <span className="block text-[10px] uppercase tracking-wide opacity-70 mb-1">
                    {message.role === "user" ? "You" : "Assistant"}
                  </span>
                  {message.role === "assistant" && !message.content ? (
                    <span className="flex flex-col gap-2">
                      {assistantStatus && (
                        <span className="text-[11px] text-amber-300/80">{assistantStatus}</span>
                      )}
                      <span className="inline-flex gap-1.5 items-center h-5">
                        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce" style={{ animationDelay: "160ms" }} />
                        <span className="w-2 h-2 rounded-full bg-amber-300/80 animate-bounce" style={{ animationDelay: "320ms" }} />
                      </span>
                    </span>
                  ) : message.role === "assistant" && assistantBusy && idx === assistantMessages.length - 1 ? (
                    <span>
                      <p className="whitespace-pre-wrap break-words">{displayMessage(message.content)}<span className="inline-block w-0.5 h-3.5 bg-amber-300/70 ml-0.5 animate-pulse align-middle" /></p>
                    </span>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{displayMessage(message.content)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!showWelcome && (
          <div className={`flex flex-wrap gap-2 transition-opacity ${assistantBusy ? "opacity-40 pointer-events-none" : ""}`}>
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onPickPrompt(prompt)}
                disabled={assistantBusy}
                className="px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-[11px] text-white"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {assistantPreview && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-100 font-semibold mb-1">Preview ready</p>
            <p className="text-xs text-white mb-2">{assistantPreview.summary}</p>
            <div className="flex flex-wrap gap-2 mb-3 text-[11px] text-white">
              <span className="px-2 py-1 rounded bg-white/15">
                Bills: {assistantPreview.diff.billDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.billDelta}
              </span>
              <span className="px-2 py-1 rounded bg-white/15">
                Items: {assistantPreview.diff.itemDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.itemDelta}
              </span>
              <span className="px-2 py-1 rounded bg-white/15">
                Priced items: {assistantPreview.diff.pricedItemsDelta >= 0 ? "+" : ""}
                {assistantPreview.diff.pricedItemsDelta}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onApplyPreview}
                className="px-3 py-1.5 rounded-md bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold"
              >
                Apply changes
              </button>
              <button
                onClick={onDiscardPreview}
                className="px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3 border-t border-white/20 bg-[#17130e]">
        <label className="text-[11px] text-gray-100">Instruction</label>
        <textarea
          className="boq-cell-editable text-white w-full min-h-[76px]"
          placeholder="Example: Add a new bill for Drainage Works and include 3 typical items with units and qty 1 where missing."
          value={assistantInput}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={assistantBusy}
        />
        <button
          onClick={onSubmit}
          disabled={assistantBusy || !assistantInput.trim()}
          className="w-full px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {assistantBusy ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-black/40 border-t-transparent animate-spin" />
              Working…
            </span>
          ) : "Generate proposal"}
        </button>
      </div>
    </section>
  );
}

function MetaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-200">{label}:</span>
      <input
        className="boq-cell-editable text-white text-xs min-w-[100px] max-w-[200px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function BillSection({
  bill,
  billIdx,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
}: {
  bill: BOQBill;
  billIdx: number;
  onUpdateItem: (itemIdx: number, field: keyof BOQItem, value: string | number | null) => void;
  onAddItem: () => void;
  onRemoveItem: (itemIdx: number) => void;
}) {
  const [open, setOpen] = useState(true);

  const billTotal = bill.items.reduce((s, it) => {
    if (it.is_header) return s;
    const amt = it.amount ?? (it.qty !== null && it.rate !== null ? it.qty * it.rate : null);
    return amt !== null ? s + amt : s;
  }, 0);

  return (
    <div className="rounded-xl border border-white/15 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1c1f25] hover:bg-[#22262e] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-200 font-mono">BILL {bill.number}</span>
          <span className="font-semibold text-white text-sm">{bill.title}</span>
          <span className="text-xs text-gray-200">({bill.items.filter((i) => !i.is_header).length} items)</span>
        </div>
        <div className="flex items-center gap-4">
          {billTotal > 0 && (
            <span className="text-xs font-mono text-amber-400">
              ZMW {billTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
            </span>
          )}
          <ChevronIcon open={open} />
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#141922] text-gray-100 border-b border-white/10">
                <th className="px-3 py-2 text-left w-[70px]">ITEM</th>
                <th className="px-3 py-2 text-left">DESCRIPTION</th>
                <th className="px-2 py-2 text-center w-[60px]">UNIT</th>
                <th className="px-2 py-2 text-right w-[70px]">QTY</th>
                <th className="px-2 py-2 text-right w-[100px]">RATE (ZMW)</th>
                <th className="px-2 py-2 text-right w-[110px]">AMOUNT (ZMW)</th>
                <th className="w-[30px]" />
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item, itemIdx) => (
                <ItemRow
                  key={itemIdx}
                  item={item}
                  onUpdate={(field, value) => onUpdateItem(itemIdx, field, value)}
                  onRemove={() => onRemoveItem(itemIdx)}
                />
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-2 bg-[#12161e] border-t border-white/10">
            <button
              onClick={onAddItem}
              className="text-xs text-gray-200 hover:text-amber-300 transition-colors"
            >
              + Add item
            </button>
            {billTotal > 0 && (
              <div className="text-xs font-mono text-gray-200">
                Subtotal:{" "}
                <span className="text-white font-semibold">
                  ZMW {billTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: BOQItem;
  onUpdate: (field: keyof BOQItem, value: string | number | null) => void;
  onRemove: () => void;
}) {
  const amount = item.amount ?? (item.qty !== null && item.rate !== null ? item.qty * item.rate : null);
  const placeholder = unresolvedPlaceholder(item);
  const displayNote = item.note && item.note !== "Incl" ? item.note : null;
  const unresolvedQty = item.qty == null;
  const lowConfidence = (item.quantity_confidence ?? 0.4) < 0.6;
  const evidenceLabel =
    item.evidence_type === "derived_calculation"
      ? "Derived"
      : item.evidence_type === "tabulated_scope"
      ? "Table"
      : item.evidence_type === "metadata_only"
      ? "Metadata"
      : item.evidence_type === "quoted_scope"
      ? "Quoted"
      : null;

  if (item.is_header) {
    return (
      <tr className="border-b border-white/10 bg-[#1a1f28]">
        <td colSpan={6} className="px-3 py-2 text-gray-100 font-semibold text-xs uppercase tracking-wide">
          {item.description}
        </td>
        <td>
          <button onClick={onRemove} className="px-1 text-gray-400 hover:text-red-300 text-xs">
            ✕
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b border-white/10 group ${
        unresolvedQty || lowConfidence ? "bg-amber-500/[0.08] hover:bg-amber-500/[0.13]" : "hover:bg-white/[0.04]"
      }`}
    >
      <td className="px-3 py-1.5">
        <input
          className="boq-cell-editable text-gray-200 font-mono w-full"
          value={item.item_no}
          onChange={(e) => onUpdate("item_no", e.target.value)}
        />
      </td>
      <td className="px-3 py-1.5 max-w-xs">
        <textarea
          className="boq-cell-editable text-white w-full min-h-[1.25rem]"
          value={item.description}
          rows={item.description.length > 80 ? 2 : 1}
          onChange={(e) => onUpdate("description", e.target.value)}
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {unresolvedQty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/30 text-amber-100">Missing qty</span>}
          {lowConfidence && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-400/30 text-orange-100">
              Low conf {((item.quantity_confidence ?? 0.4) * 100).toFixed(0)}%
            </span>
          )}
          {evidenceLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-400/20 text-sky-100">
              {evidenceLabel} evidence
            </span>
          )}
          {item.source_anchor && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-100">
              {item.source_anchor}
            </span>
          )}
          {item.source_document && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-400/20 text-violet-100">
              {item.source_document}
            </span>
          )}
        </div>
        {(item.source_excerpt || item.derivation_note || displayNote) && (
          <div className="mt-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
            {item.source_excerpt && (
              <p className="text-[10px] text-gray-200 leading-relaxed">
                {item.source_excerpt.length > 180
                  ? `${item.source_excerpt.slice(0, 177)}...`
                  : item.source_excerpt}
              </p>
            )}
            {item.derivation_note && (
              <p className="text-[10px] text-sky-200 mt-1">
                Derivation: {item.derivation_note}
              </p>
            )}
            {displayNote && (
              <p className="text-[10px] text-amber-100 mt-1">
                Note: {displayNote}
              </p>
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          className="boq-cell-editable text-gray-100 text-center w-full"
          value={item.unit}
          onChange={(e) => onUpdate("unit", e.target.value)}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-gray-100 text-right w-full font-mono"
          value={item.qty ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("qty", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-amber-200 text-right w-full font-mono"
          placeholder="—"
          value={item.rate ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("rate", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-gray-100">
        {item.note === "Incl" ? (
          <span className="text-gray-200 italic">{item.note}</span>
        ) : amount !== null ? (
          amount.toLocaleString("en-ZM", { minimumFractionDigits: 2 })
        ) : placeholder ? (
          <span className="text-gray-300 italic">{placeholder}</span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td>
        <button
          onClick={onRemove}
          className="px-1 text-transparent group-hover:text-gray-300 hover:!text-red-300 text-xs transition-colors"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function QABadge({ qa }: { qa: import("@/lib/types").BOQQualityScore }) {
  const [open, setOpen] = useState(false);
  const gradeColour =
    qa.grade === "Strong"
      ? "text-green-400 border-green-500/30 bg-green-500/10"
      : qa.grade === "Good"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : qa.grade === "Fair"
      ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
      : "text-red-400 border-red-500/30 bg-red-500/10";

  return (
    <div className="relative hidden sm:block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${gradeColour}`}
      >
        BOQ Quality: {qa.grade} · {qa.score}/10
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/15 bg-[#1a1f28] p-4 shadow-xl z-30 space-y-2">
          <p className="text-xs font-semibold text-white">{qa.summary}</p>
          {qa.subscores && (
            <div className="space-y-2 pt-1">
              <QASubscoreRow label="Coverage" value={qa.subscores.coverage} />
              <QASubscoreRow label="Source" value={qa.subscores.source_completeness} />
              <QASubscoreRow label="Field integrity" value={qa.subscores.field_integrity} />
              <QASubscoreRow label="Evidence" value={qa.subscores.evidence_traceability} />
              <QASubscoreRow label="Semantics" value={qa.subscores.boq_semantics} />
            </div>
          )}
          {qa.flags.length > 0 && (
            <ul className="space-y-1 mt-2">
              {qa.flags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-yellow-300">
                  <span className="mt-0.5 shrink-0">⚠</span>
                  {flag}
                </li>
              ))}
            </ul>
          )}
          {qa.flags.length === 0 && (
            <p className="text-xs text-green-400">No issues found.</p>
          )}
          <button onClick={() => setOpen(false)} className="text-xs text-gray-200 hover:text-white pt-1">Dismiss</button>
        </div>
      )}
    </div>
  );
}

function QASubscoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-gray-200">
        <span>{label}</span>
        <span className="font-mono text-white">{value.toFixed(1)}/10</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-300"
          style={{ width: `${Math.max(8, Math.min(100, value * 10))}%` }}
        />
      </div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-300 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
