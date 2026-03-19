import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type {
  BOQArtifacts,
  BOQDocument,
  BOQItem,
  BOQQuantityArtifactItem,
  BOQQualitySummary,
  BOQStructureArtifact,
  BOQValidationFlag,
} from "./types";

type QuantitySource = "explicit" | "derived" | "assumed";

type StructurePassResponse = {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: Array<{
    number: number;
    title: string;
    items: Array<{
      item_key?: string;
      item_no?: string;
      description: string;
      unit?: string;
      is_header?: boolean;
      note?: string | null;
    }>;
  }>;
};

type QuantityPassResponse = {
  items: Array<{
    item_key: string;
    qty: number | null;
    unit?: string;
    quantity_source?: QuantitySource | string;
    quantity_confidence?: number | null;
    source_excerpt?: string | null;
    source_anchor?: string | null;
    note?: string | null;
  }>;
};

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-flash";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.0-flash";
const MAX_ATTEMPTS_PER_MODEL = 3;

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

const STRUCTURE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    project: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING },
    prepared_by: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    bills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          number: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                item_key: { type: SchemaType.STRING, nullable: true },
                item_no: { type: SchemaType.STRING, nullable: true },
                description: { type: SchemaType.STRING },
                unit: { type: SchemaType.STRING, nullable: true },
                is_header: { type: SchemaType.BOOLEAN, nullable: true },
                note: { type: SchemaType.STRING, nullable: true },
              },
              required: ["description"],
            },
          },
        },
        required: ["number", "title", "items"],
      },
    },
  },
  required: ["project", "location", "prepared_by", "date", "bills"],
};

const QUANTITY_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item_key: { type: SchemaType.STRING },
          qty: { type: SchemaType.NUMBER, nullable: true },
          unit: { type: SchemaType.STRING, nullable: true },
          quantity_source: { type: SchemaType.STRING, nullable: true },
          quantity_confidence: { type: SchemaType.NUMBER, nullable: true },
          source_excerpt: { type: SchemaType.STRING, nullable: true },
          source_anchor: { type: SchemaType.STRING, nullable: true },
          note: { type: SchemaType.STRING, nullable: true },
        },
        required: ["item_key", "qty"],
      },
    },
  },
  required: ["items"],
};

const STRUCTURE_PROMPT = `You are an expert quantity surveyor for Southern African construction BOQs.

TASK:
Extract only BOQ structure from the provided Scope of Work.

STRICT RULES:
1. Output bill hierarchy and work-item descriptions only.
2. Do not invent quantities, rates, or amounts.
3. Keep PRELIMINARY AND GENERAL ITEMS as Bill No. 1.
4. Group remaining work into logical discipline bills.
5. Include section headers with is_header: true when needed.
6. Every non-header item must have a description and a stable item_key.
7. Use concise, technical descriptions from the SOW.
8. If project metadata is missing, infer reasonable placeholders.`;

const STRUCTURE_RECOVERY_PROMPT = `You are recovering a failed BOQ structure extraction.

TASK:
Return a non-empty BOQ structure. Prioritize capturing all measurable work items.

RULES:
1. Include at least one non-header item per relevant bill.
2. Keep PRELIMINARY AND GENERAL ITEMS as Bill No. 1.
3. Do not output quantities, rates, or amounts.
4. Use item_key for every non-header item.
5. If uncertain, include the item with best possible description rather than dropping it.`;

const QUANTITY_PROMPT = `You are a quantity extraction specialist.

TASK:
Given SOW text and a predefined BOQ item list, return quantity data keyed by item_key.

RULES:
1. Never change item_key values.
2. Any non-null qty must include source_excerpt evidence copied from SOW text.
3. Use quantity_source:
   - explicit: directly stated
   - derived: computed from stated dimensions
   - assumed: uncertain or not stated
4. If uncertain, set qty null and quantity_source assumed.
5. Set quantity_confidence between 0 and 1.
6. Use standard units (m, m², m³, No., Item, LS, kg, t).`;

export async function generateBOQ(sowText: string): Promise<BOQDocument> {
  const structureRaw = await generateStructure(sowText, false);
  let structure = normalizeStructure(structureRaw);

  if (countNonHeaderItems(structure) === 0) {
    const retryRaw = await generateStructure(sowText, true);
    structure = normalizeStructure(retryRaw);
  }

  if (countNonHeaderItems(structure) === 0) {
    throw new Error(
      "Could not extract BOQ structure from SOW (no measurable items found). Please upload a clearer scope document."
    );
  }

  const quantitiesRaw = await extractQuantities(sowText, structure);
  return mergeStructureAndQuantities(structure, quantitiesRaw);
}

async function generateStructure(
  sowText: string,
  recoveryMode: boolean
): Promise<StructurePassResponse> {
  return callModel<StructurePassResponse>({
    prompt: `Extract BOQ structure only from this SOW:\n\n${sowText}`,
    responseSchema: STRUCTURE_SCHEMA,
    systemInstruction: recoveryMode ? STRUCTURE_RECOVERY_PROMPT : STRUCTURE_PROMPT,
    temperature: recoveryMode ? 0.3 : 0.2,
  });
}

async function extractQuantities(
  sowText: string,
  structure: BOQStructureArtifact
): Promise<QuantityPassResponse> {
  const itemCatalog = structure.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header)
      .map((item) => ({
        item_key: item.item_key,
        bill_number: bill.number,
        bill_title: bill.title,
        item_no: item.item_no,
        description: item.description,
        unit_hint: item.unit,
      }))
  );

  return callModel<QuantityPassResponse>({
    prompt: `SOW TEXT:\n${sowText}\n\nITEMS TO QUANTIFY (JSON):\n${JSON.stringify(
      itemCatalog
    )}`,
    responseSchema: QUANTITY_SCHEMA,
    systemInstruction: QUANTITY_PROMPT,
    temperature: 0.1,
  });
}

async function callModel<T>({
  prompt,
  responseSchema,
  systemInstruction,
  temperature,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction: string;
  temperature: number;
}): Promise<T> {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: responseSchema as any,
      temperature,
    },
  });

  const result = await model.generateContent(prompt);
  return parseJsonResponse<T>(result.response.text());
}

function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const cleaned = trimmed.startsWith("```")
    ? trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(cleaned) as T;
}

function normalizeStructure(raw: StructurePassResponse): BOQStructureArtifact {
  return {
    project: safeText(raw.project, "Untitled BOQ"),
    location: safeText(raw.location, "Unknown Location"),
    prepared_by: safeText(raw.prepared_by, "BOQ Generator"),
    date: safeText(raw.date, new Date().toISOString().slice(0, 10)),
    bills: (raw.bills ?? []).map((bill, billIndex) => ({
      number: Number.isFinite(bill.number) ? bill.number : billIndex + 1,
      title: safeText(bill.title, `BILL ${billIndex + 1}`),
      items: (bill.items ?? []).map((item, itemIndex) => {
        const isHeader = Boolean(item.is_header);
        const itemKey =
          !isHeader && item.item_key && item.item_key.trim()
            ? item.item_key.trim()
            : `b${billIndex + 1}_i${itemIndex + 1}`;
        return {
          item_key: itemKey,
          item_no: safeText(item.item_no, ""),
          description: safeText(item.description, "Unspecified work item"),
          unit: normalizeUnit(item.unit),
          is_header: isHeader,
          note: item.note ?? undefined,
        };
      }),
    })),
  };
}

function countNonHeaderItems(structure: BOQStructureArtifact): number {
  return structure.bills.reduce(
    (sum, bill) => sum + bill.items.filter((item) => !item.is_header).length,
    0
  );
}

function mergeStructureAndQuantities(
  structure: BOQStructureArtifact,
  quantities: QuantityPassResponse
): BOQDocument {
  const quantityMap = new Map<string, BOQQuantityArtifactItem>();
  for (const item of quantities.items ?? []) {
    if (!item.item_key) continue;
    quantityMap.set(item.item_key, {
      item_key: item.item_key,
      qty: sanitizePositiveNumber(item.qty),
      unit: normalizeUnit(item.unit),
      quantity_source: normalizeSource(item.quantity_source, item.qty),
      quantity_confidence: normalizeConfidence(item.quantity_confidence),
      source_excerpt: safeNullableText(item.source_excerpt),
      source_anchor: safeNullableText(item.source_anchor),
      note: safeNullableText(item.note) ?? undefined,
    });
  }

  const validationFlags: BOQValidationFlag[] = [];
  let totalItems = 0;
  let qtyWithEvidence = 0;
  let qtyMissing = 0;
  let lowConfidence = 0;

  const bills = structure.bills.map((bill) => ({
    number: bill.number,
    title: bill.title,
    items: bill.items.map((baseItem): BOQItem => {
      if (baseItem.is_header) {
        return {
          item_key: baseItem.item_key,
          item_no: "",
          description: baseItem.description,
          unit: "",
          qty: null,
          rate: null,
          amount: null,
          is_header: true,
        };
      }

      totalItems += 1;
      const q = quantityMap.get(baseItem.item_key);
      let qty = q?.qty ?? null;
      let source = q?.quantity_source ?? "assumed";
      const confidence = q?.quantity_confidence ?? 0.4;
      const excerpt = q?.source_excerpt ?? null;
      const anchor = q?.source_anchor ?? null;

      if (qty !== null && !hasSufficientEvidence(excerpt)) {
        validationFlags.push({
          item_key: baseItem.item_key,
          issue: "missing_evidence",
          severity: "warning",
          message: "Quantity removed because supporting source evidence was missing.",
        });
        qty = null;
        source = "assumed";
      }

      if (q?.qty != null && qty === null) {
        validationFlags.push({
          item_key: baseItem.item_key,
          issue: "invalid_quantity",
          severity: "warning",
          message: "Invalid quantity value was discarded.",
        });
      }

      if (qty === null) {
        qtyMissing += 1;
        validationFlags.push({
          item_key: baseItem.item_key,
          issue: "missing_quantity",
          severity: "info",
          message: "Quantity is unresolved and requires manual review.",
        });
      } else if (hasSufficientEvidence(excerpt)) {
        qtyWithEvidence += 1;
      }

      if (confidence < 0.6) {
        lowConfidence += 1;
      }

      return {
        item_key: baseItem.item_key,
        item_no: baseItem.item_no,
        description: baseItem.description,
        unit: normalizeUnit(q?.unit || baseItem.unit),
        qty,
        rate: null,
        amount: null,
        quantity_source: source,
        quantity_confidence: confidence,
        source_excerpt: excerpt,
        source_anchor: anchor,
        note: q?.note ?? baseItem.note,
      };
    }),
  }));

  const qualitySummary: BOQQualitySummary = {
    total_items: totalItems,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
  };

  const artifacts: BOQArtifacts = {
    structure_v1: structure,
    quantities_v1: Array.from(quantityMap.values()),
    validation_flags: validationFlags,
  };

  return {
    project: structure.project,
    location: structure.location,
    prepared_by: structure.prepared_by,
    date: structure.date,
    bills,
    pipeline_version: "quantity-v1.0",
    quality_summary: qualitySummary,
    artifacts,
  };
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function safeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function sanitizePositiveNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return Number(v.toFixed(4));
}

function normalizeUnit(unit: string | null | undefined): string {
  if (!unit || typeof unit !== "string") return "Item";
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return "Item";
  if (normalized === "m2" || normalized === "sqm") return "m²";
  if (normalized === "m3" || normalized === "cum") return "m³";
  if (normalized === "no" || normalized === "nos" || normalized === "no.") return "No.";
  if (normalized === "ls") return "LS";
  if (normalized === "item") return "Item";
  if (normalized === "m") return "m";
  if (normalized === "m²") return "m²";
  if (normalized === "m³") return "m³";
  if (normalized === "kg") return "kg";
  if (normalized === "t") return "t";
  return unit.trim();
}

function normalizeSource(
  source: string | QuantitySource | undefined,
  qty: number | null | undefined
): QuantitySource {
  const clean = (source ?? "").toLowerCase();
  if (clean === "explicit" || clean === "derived" || clean === "assumed") {
    return clean;
  }
  return qty == null ? "assumed" : "explicit";
}

function normalizeConfidence(confidence: number | null | undefined): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0.4;
  if (confidence < 0) return 0;
  if (confidence > 1) return 1;
  return Number(confidence.toFixed(2));
}

export function hasSufficientEvidence(excerpt: string | null): boolean {
  if (!excerpt) return false;
  return excerpt.trim().length >= 12;
}

