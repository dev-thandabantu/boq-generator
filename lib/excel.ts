import * as XLSX from "xlsx";
import type { BOQDocument, BOQItem } from "./types";

type CellStyle = {
  font?: { bold?: boolean; sz?: number; color?: { rgb: string } };
  fill?: { fgColor: { rgb: string } };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
  border?: {
    top?: { style: string; color: { rgb: string } };
    bottom?: { style: string; color: { rgb: string } };
    left?: { style: string; color: { rgb: string } };
    right?: { style: string; color: { rgb: string } };
  };
  numFmt?: string;
};

type Cell = {
  v: string | number | null;
  t: "s" | "n";
  s?: CellStyle;
};

function cell(v: string | number | null, s?: CellStyle): Cell {
  return { v, t: typeof v === "number" ? "n" : "s", s };
}

const COLORS = {
  header_bg: "1F2937",    // dark navy header
  bill_bg: "374151",      // bill section bg
  subheader_bg: "4B5563", // subsection bg
  total_bg: "1E3A5F",     // total row bg
  white: "FFFFFF",
  amber: "F59E0B",
  light_gray: "F9FAFB",
  border: "D1D5DB",
  dark_border: "6B7280",
};

const borderThin = (color = COLORS.border) => ({
  top: { style: "thin", color: { rgb: color } },
  bottom: { style: "thin", color: { rgb: color } },
  left: { style: "thin", color: { rgb: color } },
  right: { style: "thin", color: { rgb: color } },
});

const borderMedium = (color = COLORS.dark_border) => ({
  top: { style: "medium", color: { rgb: color } },
  bottom: { style: "medium", color: { rgb: color } },
  left: { style: "medium", color: { rgb: color } },
  right: { style: "medium", color: { rgb: color } },
});

export function generateBOQExcel(boq: BOQDocument): Buffer {
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: { [key: string]: any } = {};
  const merges: XLSX.Range[] = [];

  let row = 1; // 1-indexed

  function setCell(r: number, c: number, v: string | number | null, s?: CellStyle) {
    const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    ws[ref] = cell(v, s);
  }

  function merge(r1: number, c1: number, r2: number, c2: number) {
    merges.push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
  }

  // ─── METADATA HEADER ─────────────────────────────────────────────────────
  const titleStyle: CellStyle = {
    font: { bold: true, sz: 16, color: { rgb: COLORS.amber } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
  };
  const metaLabelStyle: CellStyle = {
    font: { bold: true, sz: 11, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  const metaValueStyle: CellStyle = {
    font: { bold: false, sz: 11, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
  };

  setCell(row, 1, "BILL OF QUANTITIES", titleStyle);
  merge(row, 1, row, 6);
  row++;

  setCell(row, 1, "FOR", metaLabelStyle);
  merge(row, 1, row, 6);
  row++;

  setCell(row, 1, boq.project.toUpperCase(), {
    ...metaLabelStyle,
    font: { ...metaLabelStyle.font, sz: 13 },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  });
  merge(row, 1, row, 6);
  row++;

  setCell(row, 1, "AT", metaLabelStyle);
  setCell(row, 2, boq.location.toUpperCase(), metaValueStyle);
  merge(row, 2, row, 6);
  row++;

  setCell(row, 1, "DATE", metaLabelStyle);
  setCell(row, 2, boq.date, metaValueStyle);
  merge(row, 2, row, 6);
  row++;

  setCell(row, 1, "PREPARED BY", metaLabelStyle);
  setCell(row, 2, boq.prepared_by || "MIG ENGINEERING", metaValueStyle);
  merge(row, 2, row, 6);
  row++;

  // blank spacer
  row++;

  // ─── COLUMN HEADERS ───────────────────────────────────────────────────────
  const colHeaderStyle: CellStyle = {
    font: { bold: true, sz: 11, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.bill_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  const headers = ["ITEM NO", "DESCRIPTION", "UNIT", "QTY", "RATE\n(ZMW)", "AMOUNT\n(ZMW)"];
  headers.forEach((h, i) => setCell(row, i + 1, h, colHeaderStyle));
  row++;

  // Bill subtotals for summary
  const billTotals: { title: string; amount: number | null }[] = [];

  // ─── BILLS ────────────────────────────────────────────────────────────────
  for (const bill of boq.bills) {
    // Bill title row
    const billTitleStyle: CellStyle = {
      font: { bold: true, sz: 12, color: { rgb: COLORS.amber } },
      fill: { fgColor: { rgb: COLORS.bill_bg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderMedium(),
    };
    setCell(row, 1, `BILL NO. ${bill.number}`, billTitleStyle);
    setCell(row, 2, bill.title, billTitleStyle);
    merge(row, 2, row, 6);
    row++;

    let billTotal: number | null = null;

    for (const item of bill.items) {
      if (item.is_header) {
        // Subsection header
        const subStyle: CellStyle = {
          font: { bold: true, sz: 10, color: { rgb: COLORS.white } },
          fill: { fgColor: { rgb: COLORS.subheader_bg } },
          alignment: { horizontal: "left", vertical: "center" },
          border: borderThin(),
        };
        setCell(row, 1, "", subStyle);
        setCell(row, 2, item.description, subStyle);
        merge(row, 2, row, 6);
        row++;
        continue;
      }

      // Work item row
      const itemStyle: CellStyle = {
        font: { sz: 10 },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
        border: borderThin(),
      };
      const numStyle: CellStyle = {
        font: { sz: 10 },
        alignment: { horizontal: "center", vertical: "top" },
        border: borderThin(),
      };
      const currencyStyle: CellStyle = {
        font: { sz: 10 },
        alignment: { horizontal: "right", vertical: "top" },
        border: borderThin(),
        numFmt: "#,##0.00",
      };

      const amount = computeAmount(item);
      if (amount !== null) {
        billTotal = (billTotal ?? 0) + amount;
      }

      setCell(row, 1, item.item_no || "", { ...numStyle, font: { ...numStyle.font, bold: true } });
      setCell(row, 2, item.description, itemStyle);
      setCell(row, 3, item.unit || "", { ...numStyle });
      setCell(row, 4, item.qty ?? "", numStyle);
      setCell(row, 5, item.note ?? (item.rate !== null ? item.rate : ""), item.rate !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } });
      setCell(row, 6, item.note ?? (amount !== null ? amount : ""), amount !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } });
      row++;
    }

    // Bill subtotal row
    const totalStyle: CellStyle = {
      font: { bold: true, sz: 10, color: { rgb: COLORS.white } },
      fill: { fgColor: { rgb: COLORS.total_bg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderMedium(),
    };
    const totalAmountStyle: CellStyle = {
      ...totalStyle,
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "#,##0.00",
    };
    setCell(row, 1, "", totalStyle);
    setCell(
      row,
      2,
      `TOTAL BILL NO. ${bill.number} — ${bill.title} — CARRIED TO SUMMARY`,
      totalStyle
    );
    merge(row, 2, row, 5);
    setCell(row, 6, billTotal, billTotal !== null ? totalAmountStyle : totalStyle);
    row++;

    billTotals.push({ title: bill.title, amount: billTotal });

    // blank gap
    row++;
  }

  // ─── SUMMARY ─────────────────────────────────────────────────────────────
  const summaryTitleStyle: CellStyle = {
    font: { bold: true, sz: 13, color: { rgb: COLORS.amber } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  setCell(row, 1, "SUMMARY OF BILL OF QUANTITIES", summaryTitleStyle);
  merge(row, 1, row, 6);
  row++;

  const summaryHeaderStyle: CellStyle = {
    font: { bold: true, sz: 10, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.bill_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  setCell(row, 1, "BILL NO.", summaryHeaderStyle);
  setCell(row, 2, "DESCRIPTION", summaryHeaderStyle);
  merge(row, 2, row, 5);
  setCell(row, 6, "AMOUNT (ZMW)", summaryHeaderStyle);
  row++;

  let grandTotal: number | null = null;
  billTotals.forEach((b, i) => {
    const summaryRowStyle: CellStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderThin(),
    };
    const summaryAmtStyle: CellStyle = {
      font: { sz: 10 },
      alignment: { horizontal: "right", vertical: "center" },
      border: borderThin(),
      numFmt: "#,##0.00",
    };
    setCell(row, 1, `${i + 1}`, { ...summaryRowStyle, alignment: { horizontal: "center", vertical: "center" } });
    setCell(row, 2, b.title, summaryRowStyle);
    merge(row, 2, row, 5);
    setCell(row, 6, b.amount, b.amount !== null ? summaryAmtStyle : summaryRowStyle);
    if (b.amount !== null) grandTotal = (grandTotal ?? 0) + b.amount;
    row++;
  });

  // Grand total
  const grandTotalStyle: CellStyle = {
    font: { bold: true, sz: 12, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.total_bg } },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderMedium(),
  };
  const grandAmtStyle: CellStyle = {
    ...grandTotalStyle,
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.00",
  };
  setCell(row, 1, "", grandTotalStyle);
  setCell(row, 2, "TOTAL (VAT EXCLUSIVE)", grandTotalStyle);
  merge(row, 2, row, 5);
  setCell(row, 6, grandTotal, grandTotal !== null ? grandAmtStyle : grandTotalStyle);
  row++;
  setCell(row, 6, "ZMW", { ...grandTotalStyle, alignment: { horizontal: "right", vertical: "center" } });

  // ─── WORKSHEET SETUP ──────────────────────────────────────────────────────
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 10 },  // A: Item No
    { wch: 62 },  // B: Description
    { wch: 8 },   // C: Unit
    { wch: 10 },  // D: Qty
    { wch: 14 },  // E: Rate
    { wch: 16 },  // F: Amount
  ];
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 5 } });

  XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, "BOQ");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return buf;
}

function computeAmount(item: BOQItem): number | null {
  if (item.amount !== null) return item.amount;
  if (item.qty !== null && item.rate !== null) return item.qty * item.rate;
  return null;
}
