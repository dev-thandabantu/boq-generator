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

const STANDARD_PREAMBLES = [
  {
    no: "i",
    text: "A contractor shall familiarise himself with the works as no claims, due to failure to understand the scope of works shall be accepted",
  },
  {
    no: "ii",
    text: "Contractor shall allow in his rates the price of materials, transportation, plant, equipment, personnel and any other services required during execution of works",
  },
  {
    no: "iii",
    text: "All rates must include the supply and installation of new items/materials",
  },
  {
    no: "iv",
    text: "Where there is a discrepancy between the drawings and BOQ, consult the Engineer or other authorised client's site representative",
  },
  {
    no: "v",
    text: "The net quantities in the BOQ shall not be used for the purpose of ordering materials. All measurements must be confirmed prior to procurement of materials",
  },
  {
    no: "vi",
    text: "Samples of materials to be availed to the Engineer for approval prior to procurement; as applicable to the project",
  },
  {
    no: "vii",
    text: "Contractor shall provide signs and safety barrier tapes to be erected at site and to ensure good housekeeping at all times",
  },
  {
    no: "viii",
    text: "The contractor shall provide all required PPE i.e. helmets, gloves, safety boots, eye goggles, dust mask, work suit, etc. for his workmanship",
  },
  {
    no: "ix",
    text: "The contractor will be held responsible for any loss or damage of existing works",
  },
  {
    no: "x",
    text: "During the execution of works, site security will be the responsibility of the contractor",
  },
  {
    no: "xi",
    text: "Before handover, the contractor must clean up and dump the waste/debris to designated dump site",
  },
  {
    no: "xii",
    text: "The contractor is to make good disturbed works by all trades before handover",
  },
  {
    no: "xiii",
    text: "Unless indicated, a Contractor shall supply all materials, labour and equipment",
  },
  {
    no: "xiv",
    text: "The Contractor is to carefully read and understand the scope/BOQ as any cost that will arise from failure to understand the scope will fall on the contractor",
  },
];

function sanitizeSheetName(name: string): string {
  // Excel sheet name: max 31 chars, no : \ / ? * [ ]
  return name
    .replace(/[:\\/?*[\]]/g, "")
    .substring(0, 31)
    .trim() || "BOQ";
}

function unresolvedPlaceholder(item: BOQItem): string {
  if (item.note === "Incl") return "Incl";
  if (item.qty === null && item.rate === null) return "TO BE COMPLETED";
  return "";
}

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

  function blankRow() {
    row++;
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

  blankRow();

  // ─── COLUMN HEADERS (top-level, for preambles section) ───────────────────
  const colHeaderStyle: CellStyle = {
    font: { bold: true, sz: 11, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.bill_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  const headers = ["ITEM NO", "DESCRIPTION", "UNIT", "QTY", "RATE\n(ZMW)", "AMOUNT\n(ZMW)"];
  headers.forEach((h, i) => setCell(row, i + 1, h, colHeaderStyle));
  row++;

  blankRow();

  // ─── GENERAL PREAMBLES ────────────────────────────────────────────────────
  const preambleTitleStyle: CellStyle = {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: "left", vertical: "center" },
    border: borderThin(),
  };
  const preambleTextStyle: CellStyle = {
    font: { sz: 10 },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
    border: borderThin(),
  };
  const preambleNoStyle: CellStyle = {
    font: { sz: 10 },
    alignment: { horizontal: "center", vertical: "top" },
    border: borderThin(),
  };

  setCell(row, 1, "", preambleTitleStyle);
  setCell(row, 2, "General Preambles", preambleTitleStyle);
  merge(row, 2, row, 6);
  row++;

  blankRow();

  setCell(row, 1, "", preambleTextStyle);
  setCell(
    row,
    2,
    "The following specifications must be taken into consideration in cases where they may not be indicated:",
    { ...preambleTextStyle, font: { ...preambleTextStyle.font, bold: true } }
  );
  merge(row, 2, row, 6);
  row++;

  blankRow();

  for (const p of STANDARD_PREAMBLES) {
    setCell(row, 1, p.no, preambleNoStyle);
    setCell(row, 2, p.text, preambleTextStyle);
    merge(row, 2, row, 6);
    row++;
    blankRow();
  }

  // Bill subtotals for summary
  const billTotals: { number: number; title: string; amount: number | null }[] = [];

  // ─── BILLS ────────────────────────────────────────────────────────────────
  for (const bill of boq.bills) {
    // Bill title row — "BILL No. X" in col A, title in col B–F (merged)
    const billTitleStyle: CellStyle = {
      font: { bold: true, sz: 12, color: { rgb: COLORS.amber } },
      fill: { fgColor: { rgb: COLORS.bill_bg } },
      alignment: { horizontal: "left", vertical: "center" },
      border: borderMedium(),
    };
    setCell(row, 1, `BILL No. ${bill.number}`, billTitleStyle);
    setCell(row, 2, bill.title, billTitleStyle);
    merge(row, 2, row, 6);
    row++;

    blankRow();

    // Column headers repeated for each bill
    headers.forEach((h, i) => setCell(row, i + 1, h, colHeaderStyle));
    row++;

    blankRow();

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
        blankRow();
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
      const placeholder = unresolvedPlaceholder(item);
      setCell(
        row,
        5,
        item.rate !== null ? item.rate : placeholder,
        item.rate !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } }
      );
      setCell(
        row,
        6,
        amount !== null ? amount : placeholder,
        amount !== null ? currencyStyle : { ...numStyle, alignment: { horizontal: "center", vertical: "top" } }
      );
      row++;
      blankRow();
    }

    // Bill subtotal row
    // Format: col A blank | col B–D "TOTAL CARRIED TO SUMMARY..." | col E "ZMW" | col F amount
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
    const totalZmwStyle: CellStyle = {
      ...totalStyle,
      alignment: { horizontal: "center", vertical: "center" },
    };
    setCell(row, 1, "", totalStyle);
    setCell(row, 2, "TOTAL CARRIED TO SUMMARY OF BILL OF QUANTITIES", totalStyle);
    merge(row, 2, row, 4);
    setCell(row, 5, "ZMW", totalZmwStyle);
    setCell(row, 6, billTotal, billTotal !== null ? totalAmountStyle : totalStyle);
    row++;

    blankRow();

    billTotals.push({ number: bill.number, title: bill.title, amount: billTotal });
  }

  // ─── GENERAL SUMMARY ──────────────────────────────────────────────────────
  // Repeat the title block before the summary (matching sample BOQs)
  const summaryHeaderBlockStyle: CellStyle = {
    font: { bold: true, sz: 13, color: { rgb: COLORS.amber } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };

  setCell(row, 1, "BILL OF QUANTITIES", summaryHeaderBlockStyle);
  merge(row, 1, row, 6);
  row++;

  setCell(row, 1, "FOR", summaryHeaderBlockStyle);
  merge(row, 1, row, 6);
  row++;

  setCell(row, 1, boq.project.toUpperCase(), summaryHeaderBlockStyle);
  merge(row, 1, row, 6);
  row++;

  blankRow();

  const generalSummaryTitleStyle: CellStyle = {
    font: { bold: true, sz: 13, color: { rgb: COLORS.amber } },
    fill: { fgColor: { rgb: COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  setCell(row, 1, "GENERAL SUMMARY", generalSummaryTitleStyle);
  merge(row, 1, row, 6);
  row++;

  blankRow();

  const summaryColHeaderStyle: CellStyle = {
    font: { bold: true, sz: 10, color: { rgb: COLORS.white } },
    fill: { fgColor: { rgb: COLORS.bill_bg } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderMedium(),
  };
  setCell(row, 1, "BILL NO.", summaryColHeaderStyle);
  setCell(row, 2, "DESCRIPTION", summaryColHeaderStyle);
  merge(row, 2, row, 5);
  setCell(row, 6, "AMOUNT (ZMW)", summaryColHeaderStyle);
  row++;

  blankRow();

  let grandTotal: number | null = null;
  for (const b of billTotals) {
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
    setCell(row, 1, `${b.number}`, { ...summaryRowStyle, alignment: { horizontal: "center", vertical: "center" } });
    setCell(row, 2, `BILL No. ${b.number} ${b.title}`, summaryRowStyle);
    merge(row, 2, row, 5);
    setCell(row, 6, b.amount, b.amount !== null ? summaryAmtStyle : summaryRowStyle);
    if (b.amount !== null) grandTotal = (grandTotal ?? 0) + b.amount;
    row++;
    blankRow();
  }

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
  const grandZmwStyle: CellStyle = {
    ...grandTotalStyle,
    alignment: { horizontal: "center", vertical: "center" },
  };
  setCell(row, 1, "", grandTotalStyle);
  setCell(row, 2, "TOTAL      (VAT EXCLUSIVE)", grandTotalStyle);
  merge(row, 2, row, 4);
  setCell(row, 5, "ZMW", grandZmwStyle);
  setCell(row, 6, grandTotal, grandTotal !== null ? grandAmtStyle : grandTotalStyle);

  // ─── WORKSHEET SETUP ──────────────────────────────────────────────────────
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 10 },  // A: Item No
    { wch: 62 },  // B: Description
    { wch: 8 },   // C: Unit
    { wch: 10 },  // D: Qty
    { wch: 14 },  // E: Rate / ZMW
    { wch: 16 },  // F: Amount
  ];
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 5 } });

  const sheetName = sanitizeSheetName(`BOQ ${boq.project}`);
  XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, sheetName);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return buf;
}

function computeAmount(item: BOQItem): number | null {
  if (item.amount !== null) return item.amount;
  if (item.qty !== null && item.rate !== null) return item.qty * item.rate;
  return null;
}

/**
 * Converts an uploaded Excel file buffer to a CSV-like text representation
 * suitable for sending to Gemini for parsing/validation.
 */
export function excelToCSV(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return "";
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}

/**
 * Patches an original Excel file buffer by filling in rate and amount columns
 * using values from a BOQDocument.
 *
 * @param originalBuffer - The original Excel file as a Buffer
 * @param boq - The BOQDocument containing rate and amount values
 * @param rateColumnHeader - Exact header text of the Rate column (from validateBOQ)
 * @param amountColumnHeader - Exact header text of the Amount column (from validateBOQ)
 */
export function patchExcelWithRates(
  originalBuffer: Buffer,
  boq: BOQDocument,
  rateColumnHeader: string,
  amountColumnHeader: string
): Buffer {
  const wb = XLSX.read(originalBuffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return originalBuffer;

  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

  // Find the header row and column indices for Rate, Amount, and QTY
  let headerRow = -1;
  let rateCol = -1;
  let amountCol = -1;
  let qtyCol = -1;

  const rateHeaderNorm = rateColumnHeader.trim().toLowerCase();
  const amountHeaderNorm = amountColumnHeader.trim().toLowerCase();

  // Scan first 15 rows for headers
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 14); r++) {
    let foundRate = false;
    let foundAmount = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cellVal = ws[cellRef];
      if (!cellVal) continue;
      const text = String(cellVal.v ?? "").trim().toLowerCase();
      if (text === rateHeaderNorm) { rateCol = c; foundRate = true; }
      if (text === amountHeaderNorm) { amountCol = c; foundAmount = true; }
      // Detect QTY column to use as a row discriminator
      if (text === "qty" || text === "quantity" || text === "q'ty" || text === "quantities") {
        qtyCol = c;
      }
    }
    if (foundRate || foundAmount) { headerRow = r; break; }
  }

  if (headerRow === -1 || rateCol === -1) {
    // Can't locate rate column — return original unchanged
    return originalBuffer;
  }

  // Collect all non-header BOQ items in order
  const allItems = boq.bills.flatMap((bill) =>
    bill.items.filter((item) => !item.is_header)
  );

  // Walk data rows and fill rates by sequential position.
  // Use the QTY column as the discriminator when available: only rows with a
  // positive numeric QTY are genuine item rows. This skips preamble text,
  // bill headers, section headers, and subtotal rows, all of which have no QTY.
  let itemIndex = 0;
  for (let r = headerRow + 1; r <= range.e.r && itemIndex < allItems.length; r++) {
    if (qtyCol !== -1) {
      // Preferred path: only advance on rows that have a positive numeric QTY
      const qtyCellRef = XLSX.utils.encode_cell({ r, c: qtyCol });
      const qtyVal = ws[qtyCellRef]?.v;
      if (typeof qtyVal !== "number" || qtyVal <= 0) continue;
    } else {
      // Fallback: skip fully blank rows (legacy behaviour for simple files)
      let hasContent = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]?.v != null && String(ws[ref].v).trim() !== "") { hasContent = true; break; }
      }
      if (!hasContent) continue;
    }

    const item = allItems[itemIndex];
    itemIndex++;

    if (item.is_header) continue;

    // Write "Incl" as text for items that are absorbed into other rates
    if (item.note && /incl/i.test(item.note)) {
      ws[XLSX.utils.encode_cell({ r, c: rateCol })] = { v: "Incl", t: "s" };
    } else if (item.rate !== null) {
      ws[XLSX.utils.encode_cell({ r, c: rateCol })] = { v: item.rate, t: "n", z: "#,##0.00" };
    }
    // Amount column is intentionally NOT patched — the original =D*E formula
    // auto-recalculates when the file is opened, preserving the formula chain.
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
