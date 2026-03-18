export interface BOQItem {
  item_no: string;
  description: string;
  unit: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  is_header?: boolean;
  note?: string; // "Incl", "Rate only", etc.
}

export interface BOQBill {
  number: number;
  title: string;
  items: BOQItem[];
}

export interface BOQQualityScore {
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  flags: string[];
}

export interface BOQDocument {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: BOQBill[];
  qa?: BOQQualityScore;
}

export interface ExtractResult {
  text: string;
  pages: number;
}

export interface GenerateResult {
  boq: BOQDocument;
}
