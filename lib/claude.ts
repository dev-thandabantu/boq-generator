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
import { computeDeterministicQA, mergeQAScores } from "./boq-qa";

type QuantitySource = "explicit" | "derived" | "assumed";
type DocumentType =
  | "construction_sow"
  | "boq_or_cost_document"
  | "technical_spec_non_construction"
  | "software_product_spec"
  | "unknown";
type SOWValidationResult = {
  isSOW: boolean;
  reason: string;
  confidence: number;
  documentType: DocumentType;
  flags: string[];
};

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
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || PRIMARY_MODEL;
const MAX_ATTEMPTS_PER_MODEL = 3;
const MODEL_CANDIDATES = Array.from(
  new Set([PRIMARY_MODEL, FALLBACK_MODEL, "gemini-2.5-flash"].filter(Boolean))
);
const SOW_HEADING_TERMS = [
  "bill of quantities",
  "boq",
  "scope of work",
  "project introduction",
  "general preambles",
  "preliminaries",
  "instructions to contractors",
  "construction programme",
  "project documentation deliverables",
  "testing, inspection and handover",
  "testing and handover",
  "materials to be supplied",
];
const TRADE_SECTION_TERMS = [
  "excavation",
  "earthworks",
  "concrete",
  "reinforcement",
  "formwork",
  "masonry",
  "brickwork",
  "plaster",
  "roofing",
  "ceiling",
  "painting",
  "tiling",
  "drainage",
  "plumbing",
  "electrical",
  "civil works",
  "structural works",
  "doors",
  "windows",
  "foundations",
  "site clearance",
  "civil and structural works",
  "roofing works",
  "plumbing and drainage",
  "electrical works",
  "site works and external development",
  "health, safety & environmental",
];
const CONSTRUCTION_EXECUTION_TERMS = [
  "contractor",
  "drawings",
  "specifications",
  "project manager",
  "inspection",
  "testing",
  "commissioning",
  "workmanship",
  "materials",
  "procurement",
  "site",
  "permits",
  "ppe",
  "quality assurance",
  "method statements",
  "gantt chart",
  "supply and install",
];
const CONSTRUCTION_UNIT_PATTERN =
  /\b(?:m2|m²|m3|m³|m|mm|lm|kg|ton|tons|nr|no\.?|sum|ls)\b/gi;
const CONSTRUCTION_SPEC_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*mpa\b/gi,
  /\bbs\d{3,5}\b/gi,
  /\b\d+\s*mm\b/gi,
  /\b\d+:\d+\b/g,
  /\b\d{2,4}\s*gauge\b/gi,
  /\b\d+%\b/g,
  /\b(?:upvc|ppr|led|acrylic|ceramic|galvanized|steel|cement|mortar|conduits)\b/gi,
];
const NON_SOW_QUESTIONNAIRE_TERMS = [
  "questionnaire",
  "survey",
  "feedback",
  "respondent",
  "interview",
  "how easy is it",
  "how confident are you",
];
const NON_SOW_PRODUCT_TERMS = [
  "product requirements",
  "technical specification",
  "technical direction",
  "implementation details",
  "dashboard",
  "workflow",
  "reporting flow",
  "admin ui",
  "user story",
  "acceptance criteria",
  "schema",
  "api",
  "configuration-driven",
];
const NON_SOW_CREATIVE_TERMS = [
  "lyrics",
  "chorus",
  "verse",
  "bridge",
  "album",
  "artist",
  "melody",
];
const NON_SOW_COMMERCIAL_TERMS = [
  "quotation",
  "quote",
  "invoice",
  "price list",
  "schedule of rates",
  "rate sheet",
  "unit rate",
  "priced boq",
  "commercial offer",
  "cost summary",
  "summary of rates",
];
const NON_SOW_ABSTRACT_SECTION_TERMS = [
  "overview",
  "background",
  "problem statement",
  "success criteria",
  "open questions",
  "assumptions",
  "dependencies",
  "rollout plan",
  "migration strategy",
  "canonical terminology",
  "whatsapp",
];
const NON_SOW_PRODUCT_PATTERN =
  /\b(?:dashboard|workflow|admin ui|user story|acceptance criteria|schema|api|configuration-driven|whatsapp)\b/gi;

function countTextHits(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function countPatternHits(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 100) / 100;
}

function isUnavailableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("no longer available") ||
    (message.includes("model") && message.includes("available"))
  );
}

async function generateStructuredContent<T>({
  prompt,
  responseSchema,
  systemInstruction,
  temperature,
  preferredModel,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction?: string;
  temperature: number;
  preferredModel?: string;
}): Promise<T> {
  const candidates = Array.from(
    new Set([preferredModel, ...MODEL_CANDIDATES].filter(Boolean))
  ) as string[];

  let lastError: unknown;
  for (const modelName of candidates) {
    try {
      const model = getGenAI().getGenerativeModel({
        model: modelName,
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
    } catch (error) {
      lastError = error;
      if (!isUnavailableModelError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No Gemini model was available.");
}

function inferSOWHeuristics(text: string): SOWValidationResult {
  const preview = text.slice(0, 12000).toLowerCase();
  const headingHits = countTextHits(preview, SOW_HEADING_TERMS);
  const tradeHits = countTextHits(preview, TRADE_SECTION_TERMS);
  const executionHits = countTextHits(preview, CONSTRUCTION_EXECUTION_TERMS);
  const unitHits = countPatternHits(preview, CONSTRUCTION_UNIT_PATTERN);
  const specHits = CONSTRUCTION_SPEC_PATTERNS.reduce(
    (count, pattern) => count + countPatternHits(preview, pattern),
    0
  );
  const questionnaireHits = countTextHits(preview, NON_SOW_QUESTIONNAIRE_TERMS);
  const productHits =
    countTextHits(preview, NON_SOW_PRODUCT_TERMS) +
    countPatternHits(preview, NON_SOW_PRODUCT_PATTERN);
  const creativeHits = countTextHits(preview, NON_SOW_CREATIVE_TERMS);
  const commercialHits = countTextHits(preview, NON_SOW_COMMERCIAL_TERMS);
  const abstractSectionHits = countTextHits(preview, NON_SOW_ABSTRACT_SECTION_TERMS);
  const hasBOQTableSignals =
    preview.includes("item no") &&
    preview.includes("description") &&
    preview.includes("rate") &&
    preview.includes("amount");
  const hasConstructionDocumentSignals =
    preview.includes("scope of work") ||
    preview.includes("bill no") ||
    preview.includes("boq") ||
    preview.includes("contractor shall");
  const hasScopeLikeContent =
    headingHits >= 2 || tradeHits >= 2 || executionHits >= 4 || specHits >= 3;

  const positiveCategories = [
    headingHits >= 2,
    tradeHits >= 2,
    executionHits >= 4,
    unitHits >= 4,
    specHits >= 3,
    hasBOQTableSignals,
    hasConstructionDocumentSignals,
  ].filter(Boolean).length;
  const negativeCategories = [
    questionnaireHits >= 2,
    productHits >= 3,
    creativeHits >= 2,
    commercialHits >= 2,
    abstractSectionHits >= 4,
  ].filter(Boolean).length;

  const flags: string[] = [];
  if (positiveCategories < 2) flags.push("Missing enough construction-document markers for a reliable SOW classification.");
  if (tradeHits < 2) flags.push("Very few construction trade sections were found.");
  if (unitHits < 3 && specHits < 2) flags.push("Very little measurable or material/specification language was found.");
  if (questionnaireHits >= 2) flags.push("Document reads more like a questionnaire or survey than a works specification.");
  if (productHits >= 3) flags.push("Document reads more like a product/system specification than a construction works scope.");
  if (creativeHits >= 2) flags.push("Document reads more like creative or lyrical content than a project scope.");
  if (commercialHits >= 2) flags.push("Document reads more like a commercial/rate schedule than a scope document.");

  const positiveScore =
    headingHits * 1.35 +
    tradeHits * 1.2 +
    executionHits * 0.7 +
    Math.min(unitHits, 8) * 0.45 +
    Math.min(specHits, 8) * 0.6 +
    (hasBOQTableSignals ? 3 : 0) +
    (hasConstructionDocumentSignals ? 2 : 0) +
    positiveCategories * 0.8;
  const negativeScore =
    questionnaireHits * 1.5 +
    productHits * 1.1 +
    creativeHits * 1.8 +
    commercialHits * 1.3 +
    abstractSectionHits * 0.55 +
    negativeCategories * 0.8;

  if (hasBOQTableSignals && commercialHits >= 1 && !hasScopeLikeContent) {
    return {
      isSOW: false,
      reason:
        "This looks like a rate sheet, priced BOQ, or commercial schedule rather than a statement of work describing the underlying construction scope.",
      confidence: 0.9,
      documentType: "boq_or_cost_document",
      flags,
    };
  }

  if ((positiveCategories <= 1 && positiveScore < 6) || (negativeCategories >= 2 && positiveCategories < 3)) {
    return {
      isSOW: false,
      reason:
        "This document does not contain enough construction scope, trade, and measurable works signals to be treated as a BOQ-ready statement of work.",
      confidence: clamp01(0.8 + Math.min(0.14, Math.abs(negativeScore - positiveScore) * 0.02)),
      documentType:
        creativeHits >= 2 || questionnaireHits >= 2
          ? "technical_spec_non_construction"
          : productHits >= 3
            ? "software_product_spec"
            : "unknown",
      flags,
    };
  }

  if (positiveCategories >= 3 && positiveScore >= negativeScore + 2) {
    return {
      isSOW: true,
      reason:
        "This document contains the sectioning, trade language, contractor obligations, and measurable specification detail expected in a construction SOW/BOQ source.",
      confidence: clamp01(0.72 + Math.min(0.18, (positiveScore - negativeScore) * 0.03)),
      documentType: hasBOQTableSignals ? "boq_or_cost_document" : "construction_sow",
      flags,
    };
  }

  return {
    isSOW: false,
    reason:
      "This document does not show enough reliable construction BOQ signals to safely treat it as a statement of work.",
    confidence: clamp01(0.55 + Math.min(0.2, Math.abs(negativeScore - positiveScore) * 0.02)),
    documentType:
      questionnaireHits >= 2 || creativeHits >= 2
        ? "technical_spec_non_construction"
        : productHits >= 3
          ? "software_product_spec"
          : "unknown",
    flags,
  };
}

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
  return generateStructuredContent<T>({
    preferredModel: PRIMARY_MODEL,
    prompt,
    responseSchema,
    systemInstruction,
    temperature,
  });
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

/**
 * SOW Validation
 * 
 * This function validates whether the provided text is a Scope of Work, project specification, or similar construction/engineering document suitable for BOQ extraction.
 * 
 * @param text - The text to validate.
 * @returns An object containing the validation result and the reason for the determination.
 */
const SOW_VALIDATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    isSOW: {
      type: SchemaType.BOOLEAN,
      description: "True if the document is a Scope of Work, project specification, or similar construction/engineering document suitable for BOQ extraction",
    },
    reason: {
      type: SchemaType.STRING,
      description: "One sentence explaining the determination",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence from 0 to 1",
    },
    documentType: {
      type: SchemaType.STRING,
      description:
        "One of: construction_sow, boq_or_cost_document, technical_spec_non_construction, software_product_spec, unknown",
    },
    flags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Specific warning flags that influenced the determination",
    },
  },
  required: ["isSOW", "reason", "confidence", "documentType", "flags"],
};

export async function validateSOW(text: string): Promise<SOWValidationResult> {
  const preview = text.slice(0, 6000);
  const heuristic = inferSOWHeuristics(text);

  if (!heuristic.isSOW && heuristic.confidence >= 0.82) {
    return heuristic;
  }

  try {
    const llm = await generateStructuredContent<SOWValidationResult>({
      preferredModel: FALLBACK_MODEL,
      responseSchema: SOW_VALIDATION_SCHEMA,
      temperature: 0,
      prompt: `Analyse this document excerpt and classify whether it is suitable for construction BOQ generation.

Only classify as isSOW=true if the document is a construction/engineering scope of work, specification, BOQ, or similar works document describing measurable physical work items.

Classify as isSOW=false for software product specs, PRDs, migration plans, workflow specs, UI requirements, policy documents, meeting notes, general strategy documents, questionnaires, surveys, lyrics, and priced BOQs/rate schedules that do not describe the underlying works scope.

Deterministic signals already observed:
- heuristic_is_sow: ${heuristic.isSOW}
- heuristic_document_type: ${heuristic.documentType}
- heuristic_reason: ${heuristic.reason}
- heuristic_flags: ${heuristic.flags.join("; ") || "none"}

Document excerpt:
${preview}`,
    });

    const llmLooksNonSow =
      !llm.isSOW ||
      llm.documentType === "software_product_spec" ||
      llm.documentType === "technical_spec_non_construction" ||
      llm.documentType === "boq_or_cost_document";

    if (!heuristic.isSOW && llmLooksNonSow) {
      return {
        isSOW: false,
        reason: llm.reason || heuristic.reason,
        confidence: clamp01(Math.max(heuristic.confidence, llm.confidence ?? 0.7)),
        documentType:
          llm.documentType === "unknown" ? heuristic.documentType : llm.documentType,
        flags: Array.from(new Set([...heuristic.flags, ...(llm.flags ?? [])])).slice(0, 6),
      };
    }

    if (heuristic.isSOW && llm.isSOW) {
      return {
        isSOW: true,
        reason: llm.reason || heuristic.reason,
        confidence: clamp01(Math.max(heuristic.confidence, llm.confidence ?? 0.65)),
        documentType:
          llm.documentType === "unknown" ? heuristic.documentType : llm.documentType,
        flags: Array.from(new Set([...heuristic.flags, ...(llm.flags ?? [])])).slice(0, 6),
      };
    }

    return heuristic.confidence >= (llm.confidence ?? 0.5) ? heuristic : llm;
  } catch (error) {
    console.warn("validateSOW falling back to heuristic classification:", error);
    return heuristic;
  }
}

// ─── BOQ Quality Scoring ────────────────────────────────────────────────────

const QA_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.NUMBER, description: "Overall quality score from 1 (very poor) to 10 (excellent)" },
    grade: { type: SchemaType.STRING, description: "One of: Strong, Good, Fair, Weak" },
    summary: { type: SchemaType.STRING, description: "One sentence overall assessment" },
    flags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of specific quality warnings or issues found (empty array if none)",
    },
  },
  required: ["score", "grade", "summary", "flags"],
};

export async function scoreBOQ(boq: import("./types").BOQDocument): Promise<{
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  flags: string[];
  source?: "deterministic" | "hybrid";
  updated_at?: string;
}> {
  const deterministic = computeDeterministicQA(boq);
  const totalItems = boq.bills.reduce((s, b) => s + b.items.filter((i) => !i.is_header).length, 0);
  const pricedItems = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && i.rate !== null).length,
    0
  );
  const billTitles = boq.bills.map((b) => b.title).join(", ");
  const hasPreliminaries = boq.bills.some((b) =>
    b.title.toUpperCase().includes("PRELIM")
  );
  const emptyDescriptions = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && (!i.description || i.description.trim().length < 5)).length,
    0
  );
  const zeroQty = boq.bills.reduce(
    (s, b) => s + b.items.filter((i) => !i.is_header && i.qty === 0).length,
    0
  );

  const summary = `Project: ${boq.project}. Bills (${boq.bills.length}): ${billTitles}. Total line items: ${totalItems}. Priced items: ${pricedItems}. Has Preliminaries bill: ${hasPreliminaries}. Empty descriptions: ${emptyDescriptions}. Zero-quantity items: ${zeroQty}.`;

  
  try {
    const llm = await generateStructuredContent<{
      score: number;
      grade: "Strong" | "Good" | "Fair" | "Weak";
      summary: string;
      flags: string[];
    }>({
      preferredModel: FALLBACK_MODEL,
      responseSchema: QA_SCHEMA,
      temperature: 0,
      prompt: `You are a senior quantity surveyor reviewing a generated Bill of Quantities for quality. Score this BOQ and identify any issues.\n\nBOQ summary:\n${summary}\n\nKnown deterministic assessment:\nScore ${deterministic.score}/10, grade ${deterministic.grade}, flags: ${deterministic.flags.join("; ") || "none"}.\n\nFull BOQ (JSON):\n${JSON.stringify(boq, null, 2).slice(0, 16000)}`,
    });
    return mergeQAScores(deterministic, llm);
  } catch (error) {
    console.warn("Falling back to deterministic QA score:", error);
    return deterministic;
  }
}

export async function generateBOQ(
  sowText: string,
  opts?: { suggestRates?: boolean }
): Promise<BOQDocument> {
  
  void opts?.suggestRates; // reserved for future rate-suggestion pass
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
