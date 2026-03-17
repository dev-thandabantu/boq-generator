export interface BOQItem {
  item_key?: string;
  item_no: string;
  description: string;
  unit: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  quantity_source?: "explicit" | "derived" | "assumed";
  quantity_confidence?: number | null; // 0..1
  source_excerpt?: string | null;
  source_anchor?: string | null;
  is_header?: boolean;
  note?: string; // "Incl", "Rate only", etc.
}

export interface BOQBill {
  number: number;
  title: string;
  items: BOQItem[];
}

export interface BOQDocument {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: BOQBill[];
  pipeline_version?: string;
  quality_summary?: BOQQualitySummary;
  artifacts?: BOQArtifacts;
}

export interface BOQValidationFlag {
  item_key: string;
  issue:
    | "missing_quantity"
    | "missing_evidence"
    | "invalid_quantity"
    | "invalid_confidence";
  severity: "info" | "warning";
  message: string;
}

export interface BOQQualitySummary {
  total_items: number;
  qty_with_evidence: number;
  qty_missing: number;
  low_confidence: number;
}

export interface BOQStructureArtifactItem {
  item_key: string;
  item_no: string;
  description: string;
  unit: string;
  is_header?: boolean;
  note?: string;
}

export interface BOQStructureArtifact {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: Array<{
    number: number;
    title: string;
    items: BOQStructureArtifactItem[];
  }>;
}

export interface BOQQuantityArtifactItem {
  item_key: string;
  qty: number | null;
  unit: string;
  quantity_source?: "explicit" | "derived" | "assumed";
  quantity_confidence?: number | null;
  source_excerpt?: string | null;
  source_anchor?: string | null;
  note?: string;
}

export interface BOQArtifacts {
  structure_v1: BOQStructureArtifact;
  quantities_v1: BOQQuantityArtifactItem[];
  validation_flags: BOQValidationFlag[];
}

export interface ExtractResult {
  text: string;
  pages: number;
}

export interface GenerateResult {
  boq: BOQDocument;
}
