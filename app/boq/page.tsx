"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { BOQDocument, BOQBill, BOQItem } from "@/lib/types";

export default function BOQPage() {
  const router = useRouter();
  const [boq, setBOQ] = useState<BOQDocument | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("boq_data");
    if (!raw) { router.replace("/"); return; }
    try { setBOQ(JSON.parse(raw)); } catch { router.replace("/"); }
  }, [router]);

  const updateBOQ = useCallback((updated: BOQDocument) => {
    setBOQ(updated);
    sessionStorage.setItem("boq_data", JSON.stringify(updated));
    setSaved(false);
  }, []);

  function updateItem(billIdx: number, itemIdx: number, field: keyof BOQItem, value: string | number | null) {
    if (!boq) return;
    const bills = boq.bills.map((b, bi) => {
      if (bi !== billIdx) return b;
      const items = b.items.map((it, ii) => {
        if (ii !== itemIdx) return it;
        const updated = { ...it, [field]: value };
        // Auto-compute amount
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
      const newItem: BOQItem = { item_no: "", description: "", unit: "Item", qty: 1, rate: null, amount: null };
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
      setSaved(true);
    } catch (e) {
      alert("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  if (!boq) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const grandTotal = boq.bills.reduce((sum, b) => {
    const billTotal = b.items.reduce((s, it) => {
      const amt = it.amount ?? (it.qty !== null && it.rate !== null ? it.qty * it.rate : null);
      return amt !== null ? s + amt : s;
    }, 0);
    return sum + billTotal;
  }, 0);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.push("/")}
              className="text-gray-500 hover:text-gray-300 text-sm shrink-0"
            >
              ← New
            </button>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">{boq.location}</p>
              <h1 className="text-sm font-semibold text-white truncate">{boq.project}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {grandTotal > 0 && (
              <span className="hidden sm:block text-xs text-gray-500">
                Total:{" "}
                <span className="text-amber-400 font-mono">
                  ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
                </span>
              </span>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {exporting ? "Exporting…" : saved ? "✓ Download Excel" : "Download Excel"}
            </button>
          </div>
        </div>

        {/* Editable meta */}
        <div className="max-w-7xl mx-auto px-4 pb-2 flex flex-wrap gap-4 text-xs text-gray-500">
          <MetaField label="Project" value={boq.project} onChange={(v) => updateBOQ({ ...boq, project: v })} />
          <MetaField label="Location" value={boq.location} onChange={(v) => updateBOQ({ ...boq, location: v })} />
          <MetaField label="Prepared by" value={boq.prepared_by} onChange={(v) => updateBOQ({ ...boq, prepared_by: v })} />
          <MetaField label="Date" value={boq.date} onChange={(v) => updateBOQ({ ...boq, date: v })} />
        </div>
      </header>

      {/* Bills */}
      <main className="max-w-7xl mx-auto px-2 sm:px-4 py-6 space-y-6">
        {boq.bills.map((bill, billIdx) => (
          <BillSection
            key={billIdx}
            bill={bill}
            billIdx={billIdx}
            onUpdateItem={(itemIdx, field, value) => updateItem(billIdx, itemIdx, field, value)}
            onAddItem={() => addItem(billIdx)}
            onRemoveItem={(itemIdx) => removeItem(billIdx, itemIdx)}
          />
        ))}

        {/* Grand Total */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex justify-between items-center">
          <span className="font-bold text-white">TOTAL (VAT EXCLUSIVE)</span>
          <span className="font-mono font-bold text-amber-400 text-lg">
            ZMW {grandTotal.toLocaleString("en-ZM", { minimumFractionDigits: 2 })}
          </span>
        </div>
      </main>
    </div>
  );
}

function MetaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-600">{label}:</span>
      <input
        className="boq-cell-editable text-white text-xs min-w-[100px] max-w-[200px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function BillSection({
  bill, billIdx, onUpdateItem, onAddItem, onRemoveItem,
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
    <div className="rounded-xl border border-white/10 overflow-hidden">
      {/* Bill header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-[#1a1a1a] hover:bg-[#1e1e1e] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-mono">BILL {bill.number}</span>
          <span className="font-semibold text-white text-sm">{bill.title}</span>
          <span className="text-xs text-gray-600">({bill.items.filter((i) => !i.is_header).length} items)</span>
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
              <tr className="bg-[#111] text-gray-500 border-b border-white/5">
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

          {/* Bill footer */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#111] border-t border-white/5">
            <button
              onClick={onAddItem}
              className="text-xs text-gray-500 hover:text-amber-400 transition-colors"
            >
              + Add item
            </button>
            {billTotal > 0 && (
              <div className="text-xs font-mono text-gray-400">
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
  item, onUpdate, onRemove,
}: {
  item: BOQItem;
  onUpdate: (field: keyof BOQItem, value: string | number | null) => void;
  onRemove: () => void;
}) {
  const amount = item.amount ?? (item.qty !== null && item.rate !== null ? item.qty * item.rate : null);

  if (item.is_header) {
    return (
      <tr className="border-b border-white/5 bg-[#161616]">
        <td colSpan={6} className="px-3 py-2 text-gray-400 font-semibold text-xs uppercase tracking-wide">
          {item.description}
        </td>
        <td>
          <button onClick={onRemove} className="px-1 text-gray-700 hover:text-red-400 text-xs">✕</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] group">
      <td className="px-3 py-1.5">
        <input
          className="boq-cell-editable text-gray-400 font-mono w-full"
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
      </td>
      <td className="px-2 py-1.5 text-center">
        <input
          className="boq-cell-editable text-gray-300 text-center w-full"
          value={item.unit}
          onChange={(e) => onUpdate("unit", e.target.value)}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-gray-300 text-right w-full font-mono"
          value={item.qty ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("qty", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input
          className="boq-cell-editable text-amber-400/80 text-right w-full font-mono"
          placeholder="—"
          value={item.rate ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate("rate", v === "" ? null : parseFloat(v) || null);
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-gray-300">
        {item.note ? (
          <span className="text-gray-500 italic">{item.note}</span>
        ) : amount !== null ? (
          amount.toLocaleString("en-ZM", { minimumFractionDigits: 2 })
        ) : (
          <span className="text-gray-700">—</span>
        )}
      </td>
      <td>
        <button
          onClick={onRemove}
          className="px-1 text-transparent group-hover:text-gray-700 hover:!text-red-400 text-xs transition-colors"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
