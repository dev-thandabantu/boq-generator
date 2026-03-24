import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type {
  BOQArtifacts,
  BOQDocumentType,
  BOQEvidenceType,
  BOQDocument,
  DocumentClassification,
  BOQItem,
  BOQQuantityArtifactItem,
  BOQQualitySummary,
  RequiredAttachment,
  RequiredAttachmentType,
  SourceBundleDocument,
  SourceBundleStatus,
  BOQStructureArtifact,
  BOQValidationFlag,
} from "./types";
import { computeDeterministicQA, mergeQAScores } from "./boq-qa";

type QuantitySource = "explicit" | "derived" | "assumed";
type SOWValidationResult = DocumentClassification;
export type GenerationInputDocument = {
  document_id: string;
  name: string;
  role: "primary" | "supporting";
  document_type?: BOQDocumentType | RequiredAttachmentType | "supporting_context";
  text: string;
  pages?: number | null;
};
type GenerationInputBundle = {
  documents: GenerationInputDocument[];
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
      section_context?: string | null;
      source_excerpt?: string | null;
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
    source_document?: string | null;
    evidence_type?: BOQEvidenceType | string | null;
    derivation_note?: string | null;
    note?: string | null;
  }>;
};

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-pro";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash";
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
const REQUIRED_ATTACHMENT_PATTERNS: Array<{
  pattern: RegExp;
  type: RequiredAttachmentType;
  reason: string;
}> = [
  { pattern: /\brefer to (the )?attached boq\b/i, type: "boq", reason: "The SOW explicitly refers to an attached BOQ." },
  { pattern: /\bunabridged boq attached\b/i, type: "boq", reason: "The SOW says the unabridged BOQ is attached." },
  { pattern: /\bappendix\s+[a-z0-9]+\b/i, type: "schedule", reason: "The SOW references an appendix that may contain scope detail." },
  { pattern: /\battached drawing\b/i, type: "drawing", reason: "The SOW references an attached drawing." },
  { pattern: /\bdrawing to be issued\b/i, type: "drawing", reason: "The SOW states that a drawing is required or will be issued separately." },
  { pattern: /\bdocuments attached to this scope\b/i, type: "schedule", reason: "The SOW lists supporting documents attached to the scope." },
];

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
  thinkingBudget = -1,
}: {
  prompt: string;
  responseSchema: object;
  systemInstruction?: string;
  temperature: number;
  preferredModel?: string;
  /** Gemini thinking token budget. -1 = dynamic (default). 0 = disabled. */
  thinkingBudget?: number;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as any,
          temperature,
          thinkingConfig: { thinkingBudget },
        } as any,
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

function detectRequiredAttachments(text: string): RequiredAttachment[] {
  const matches = REQUIRED_ATTACHMENT_PATTERNS.filter(({ pattern }) => pattern.test(text));
  const deduped = new Map<string, RequiredAttachment>();
  for (const match of matches) {
    const key = `${match.type}:${match.reason}`;
    deduped.set(key, {
      type: match.type,
      reason: match.reason,
      required: true,
    });
  }
  return Array.from(deduped.values());
}

function inferSourceBundleStatus(
  requiredAttachments: RequiredAttachment[],
  supportingDocsCount = 0
): SourceBundleStatus {
  if (requiredAttachments.length > 0 && supportingDocsCount < requiredAttachments.length) {
    return "missing_required_attachments";
  }
  if (supportingDocsCount > 0 && requiredAttachments.length === 0) {
    return "partial_optional_context";
  }
  return "complete";
}

function normalizeSourceDocumentType(
  type: GenerationInputDocument["document_type"] | undefined,
  role: "primary" | "supporting"
): SourceBundleDocument["document_type"] {
  if (type) return type;
  return role === "primary" ? "construction_sow" : "supporting_context";
}

function buildSourceBundle(documents: GenerationInputDocument[]): SourceBundleDocument[] {
  return documents.map((doc) => ({
    document_id: doc.document_id,
    name: doc.name,
    document_type: normalizeSourceDocumentType(doc.document_type, doc.role),
    role: doc.role,
    pages: doc.pages ?? null,
  }));
}

function buildPromptBundle(documents: GenerationInputDocument[]): string {
  return documents
    .map((doc, index) => {
      const label = doc.role === "primary" ? "PRIMARY SOW" : `ATTACHED ${doc.document_type ?? "DOCUMENT"}`;
      return [
        `### ${label} ${index + 1}`,
        `document_id: ${doc.document_id}`,
        `name: ${doc.name}`,
        `pages: ${doc.pages ?? "unknown"}`,
        doc.text,
      ].join("\n");
    })
    .join("\n\n");
}

function inferSOWHeuristics(text: string, supportingDocsCount = 0): SOWValidationResult {
  const preview = text.slice(0, 12000).toLowerCase();
  const requiredAttachments = detectRequiredAttachments(text);
  const sourceBundleStatus = inferSourceBundleStatus(requiredAttachments, supportingDocsCount);
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
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  if (positiveCategories < 2) flags.push("Missing enough construction-document markers for a reliable SOW classification.");
  if (tradeHits < 2) flags.push("Very few construction trade sections were found.");
  if (unitHits < 3 && specHits < 2) flags.push("Very little measurable or material/specification language was found.");
  if (questionnaireHits >= 2) flags.push("Document reads more like a questionnaire or survey than a works specification.");
  if (productHits >= 3) flags.push("Document reads more like a product/system specification than a construction works scope.");
  if (creativeHits >= 2) flags.push("Document reads more like creative or lyrical content than a project scope.");
  if (commercialHits >= 2) flags.push("Document reads more like a commercial/rate schedule than a scope document.");
  if (headingHits >= 2) positiveSignals.push("Contains recognised scope/BOQ headings.");
  if (tradeHits >= 2) positiveSignals.push("Contains construction trade sections.");
  if (executionHits >= 4) positiveSignals.push("Contains contractor/specification execution language.");
  if (unitHits >= 4 || specHits >= 3) positiveSignals.push("Contains measurable/specification detail.");
  if (hasBOQTableSignals) positiveSignals.push("Contains BOQ-style tabular columns.");
  if (questionnaireHits >= 2) negativeSignals.push("Questionnaire/survey style prompts detected.");
  if (productHits >= 3) negativeSignals.push("Product/software specification language detected.");
  if (creativeHits >= 2) negativeSignals.push("Creative or lyrical language detected.");
  if (commercialHits >= 2) negativeSignals.push("Commercial/rate-sheet language detected.");
  if (abstractSectionHits >= 4) negativeSignals.push("Abstract planning sections outweigh scope detail.");

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
      should_block_generation: true,
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
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
          ? "questionnaire_or_survey"
          : productHits >= 3
            ? "product_or_software_spec"
            : "unknown",
      should_block_generation:
        sourceBundleStatus === "missing_required_attachments" ? true : true,
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      flags,
    };
  }

  if (positiveCategories >= 3 && positiveScore >= negativeScore + 2) {
    return {
      isSOW: true,
      reason:
        "This document contains the sectioning, trade language, contractor obligations, and measurable specification detail expected in a construction SOW/BOQ source.",
      confidence: clamp01(0.72 + Math.min(0.18, (positiveScore - negativeScore) * 0.03)),
      documentType:
        hasBOQTableSignals && hasScopeLikeContent ? "engineering_spec" : "construction_sow",
      should_block_generation: sourceBundleStatus === "missing_required_attachments",
      required_attachments: requiredAttachments,
      source_bundle_status: sourceBundleStatus,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
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
        ? "creative_or_unstructured"
        : productHits >= 3
          ? "product_or_software_spec"
          : "unknown",
    should_block_generation: true,
    required_attachments: requiredAttachments,
    source_bundle_status: sourceBundleStatus,
    positive_signals: positiveSignals,
    negative_signals: negativeSignals,
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
                section_context: { type: SchemaType.STRING, nullable: true },
                source_excerpt: { type: SchemaType.STRING, nullable: true },
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
          source_document: { type: SchemaType.STRING, nullable: true },
          evidence_type: { type: SchemaType.STRING, nullable: true },
          derivation_note: { type: SchemaType.STRING, nullable: true },
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
6. Use standard units (m, m², m³, No., Item, LS, kg, t).
7. Set evidence_type:
   - quoted_scope: directly quoted from prose scope
   - tabulated_scope: from tabular BOQ/schedule text
   - derived_calculation: calculated from stated dimensions
   - metadata_only: only document metadata available
   - missing: no usable evidence
8. Set source_anchor to the nearest page marker (for example "Page 3") when page markers are present. Otherwise use the nearest section heading or document anchor.
9. Set source_document to the document_id that the evidence came from.
10. If evidence_type is derived_calculation, add derivation_note explaining the math briefly.`;

async function generateStructure(
  bundleText: string,
  recoveryMode: boolean
): Promise<StructurePassResponse> {
  return callModel<StructurePassResponse>({
    prompt: `Extract BOQ structure only from this document bundle:\n\n${bundleText}`,
    responseSchema: STRUCTURE_SCHEMA,
    systemInstruction: recoveryMode ? STRUCTURE_RECOVERY_PROMPT : STRUCTURE_PROMPT,
    temperature: recoveryMode ? 0.3 : 0.2,
  });
}

async function extractQuantities(
  bundleText: string,
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
    prompt: `DOCUMENT BUNDLE:\n${bundleText}\n\nITEMS TO QUANTIFY (JSON):\n${JSON.stringify(
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
          section_context: safeNullableText(item.section_context) ?? undefined,
          source_excerpt: safeNullableText(item.source_excerpt),
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

function normalizeLabelText(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|for|with|including|new|approved|complete|as|per)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCountableDrawingLabel(description: string): boolean {
  const normalized = normalizeLabelText(description);
  if (!normalized) return false;
  const wordCount = normalized.split(" ").length;
  const hasComma = description.includes(",");
  const hasLongSentence = wordCount > 5;
  const actionLike = /\b(install|construct|provide|erect|supply|lay|testing|commissioning)\b/i.test(
    description
  );
  return !hasComma && !hasLongSentence && !actionLike;
}

function countLabelMatches(text: string, description: string): { count: number; excerpt: string | null } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedTarget = normalizeLabelText(description);
  if (!normalizedTarget) return { count: 0, excerpt: null };

  let count = 0;
  let excerpt: string | null = null;
  for (const line of lines) {
    const normalizedLine = normalizeLabelText(line);
    if (!normalizedLine) continue;
    if (
      normalizedLine === normalizedTarget ||
      normalizedLine.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedLine)
    ) {
      count += 1;
      if (!excerpt) excerpt = line;
    }
  }

  return { count, excerpt };
}

function applyDrawingCountHeuristics(
  structure: BOQStructureArtifact,
  quantities: QuantityPassResponse,
  documents: GenerationInputDocument[]
): QuantityPassResponse {
  const itemMeta = new Map<string, { description: string; unit: string }>();
  for (const bill of structure.bills) {
    for (const item of bill.items) {
      if (!item.is_header) {
        itemMeta.set(item.item_key, { description: item.description, unit: item.unit });
      }
    }
  }

  const supportingDocs = documents.filter((doc) => doc.role === "supporting" && doc.text.trim().length > 0);
  if (supportingDocs.length === 0) return quantities;

  return {
    items: (quantities.items ?? []).map((item) => {
      if (item.qty !== null && item.qty !== undefined) return item;
      const meta = itemMeta.get(item.item_key);
      if (!meta || !isCountableDrawingLabel(meta.description)) return item;

      let best: { count: number; excerpt: string | null; docId: string | null } = {
        count: 0,
        excerpt: null,
        docId: null,
      };

      for (const doc of supportingDocs) {
        const match = countLabelMatches(doc.text, meta.description);
        if (match.count > best.count) {
          best = { count: match.count, excerpt: match.excerpt, docId: doc.document_id };
        }
      }

      if (best.count <= 0 || best.count > 5) return item;

      return {
        ...item,
        qty: best.count,
        unit: item.unit ?? (meta.unit && meta.unit !== "Item" ? meta.unit : "No."),
        quantity_source: "derived",
        quantity_confidence: 0.55,
        source_excerpt: best.excerpt ?? item.source_excerpt ?? null,
        source_anchor: item.source_anchor ?? "Drawing label count",
        source_document: best.docId ?? item.source_document ?? null,
        evidence_type: "derived_calculation",
        derivation_note:
          item.derivation_note ??
          `Counted ${best.count} matching drawing label${best.count === 1 ? "" : "s"} for "${meta.description}".`,
      };
    }),
  };
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
        "One of: construction_sow, engineering_spec, boq_or_cost_document, questionnaire_or_survey, product_or_software_spec, creative_or_unstructured, unknown",
    },
    should_block_generation: {
      type: SchemaType.BOOLEAN,
      description: "True when BOQ generation should be blocked for this document",
    },
    required_attachments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING },
          reason: { type: SchemaType.STRING },
          required: { type: SchemaType.BOOLEAN },
        },
        required: ["type", "reason", "required"],
      },
    },
    source_bundle_status: {
      type: SchemaType.STRING,
      description: "One of: complete, missing_required_attachments, partial_optional_context",
    },
    positive_signals: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "General construction-document signals detected in the input",
    },
    negative_signals: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Signals suggesting the document is not a valid BOQ source",
    },
    flags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Specific warning flags that influenced the determination",
    },
  },
  required: [
    "isSOW",
    "reason",
    "confidence",
    "documentType",
    "should_block_generation",
    "required_attachments",
    "source_bundle_status",
    "positive_signals",
    "negative_signals",
    "flags",
  ],
};

export async function validateSOW(
  text: string,
  opts?: { supportingDocsCount?: number }
): Promise<SOWValidationResult> {
  const preview = text.slice(0, 6000);
  const heuristic = inferSOWHeuristics(text, opts?.supportingDocsCount ?? 0);

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
      llm.documentType === "product_or_software_spec" ||
      llm.documentType === "questionnaire_or_survey" ||
      llm.documentType === "creative_or_unstructured" ||
      llm.documentType === "boq_or_cost_document";

    if (!heuristic.isSOW && llmLooksNonSow) {
      return {
        isSOW: false,
        reason: llm.reason || heuristic.reason,
        confidence: clamp01(Math.max(heuristic.confidence, llm.confidence ?? 0.7)),
        documentType:
          llm.documentType === "unknown" ? heuristic.documentType : llm.documentType,
        should_block_generation: llm.should_block_generation ?? true,
        required_attachments:
          llm.required_attachments?.length > 0
            ? llm.required_attachments
            : heuristic.required_attachments,
        source_bundle_status:
          llm.source_bundle_status ?? heuristic.source_bundle_status,
        positive_signals: Array.from(
          new Set([...(heuristic.positive_signals ?? []), ...(llm.positive_signals ?? [])])
        ).slice(0, 6),
        negative_signals: Array.from(
          new Set([...(heuristic.negative_signals ?? []), ...(llm.negative_signals ?? [])])
        ).slice(0, 6),
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
        should_block_generation: llm.should_block_generation ?? false,
        required_attachments:
          llm.required_attachments?.length > 0
            ? llm.required_attachments
            : heuristic.required_attachments,
        source_bundle_status:
          llm.source_bundle_status ?? heuristic.source_bundle_status,
        positive_signals: Array.from(
          new Set([...(heuristic.positive_signals ?? []), ...(llm.positive_signals ?? [])])
        ).slice(0, 6),
        negative_signals: Array.from(
          new Set([...(heuristic.negative_signals ?? []), ...(llm.negative_signals ?? [])])
        ).slice(0, 6),
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
    subscores: {
      type: SchemaType.OBJECT,
      properties: {
        coverage: { type: SchemaType.NUMBER },
        source_completeness: { type: SchemaType.NUMBER },
        field_integrity: { type: SchemaType.NUMBER },
        evidence_traceability: { type: SchemaType.NUMBER },
        boq_semantics: { type: SchemaType.NUMBER },
      },
      required: ["coverage", "source_completeness", "field_integrity", "evidence_traceability", "boq_semantics"],
    },
  },
  required: ["score", "grade", "summary", "flags", "subscores"],
};

export async function scoreBOQ(boq: import("./types").BOQDocument): Promise<{
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  flags: string[];
  subscores?: {
    coverage: number;
    source_completeness: number;
    field_integrity: number;
    evidence_traceability: number;
    boq_semantics: number;
  };
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
      subscores: {
        coverage: number;
        source_completeness: number;
        field_integrity: number;
        evidence_traceability: number;
        boq_semantics: number;
      };
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

// ─── Rate Estimation ────────────────────────────────────────────────────────

const RATES_INSTRUCTION = `ZAMBIAN CONSTRUCTION MARKET RATES (Q1 2026, ZMW) — use for rate estimation:

PRELIMINARIES & GENERAL:
- Mobilisation/demobilisation: 50,000–500,000 ZMW (LS, scale with project size)
- Site establishment & offices: 30,000–200,000 ZMW (LS)
- Health, safety & environmental: 15,000–100,000 ZMW (LS)
- Project management & supervision: use LS item ~5–8% of works cost
- Insurance & performance bond: 1.5–2.5% of contract sum (LS)
- As-built drawings & documentation: 10,000–50,000 ZMW (LS)

EARTHWORKS & SITE CLEARANCE:
- Site clearing & grubbing: 15–45 ZMW/m²
- Topsoil strip (100mm): 30–60 ZMW/m²
- Bulk excavation in soft/pickable ground: 40–90 ZMW/m³ (common range: 55–70)
- Bulk excavation in hard/rocky ground: 150–380 ZMW/m³
- Trench excavation (soft ground): 80–200 ZMW/m³
- Filling & compaction (imported fill): 140–320 ZMW/m³
- Backfilling from excavation: 40–80 ZMW/m³
- Compacting surface/sub-grade: 100–200 ZMW/m²
- Hardcore sub-base 150mm: 180–350 ZMW/m²
- Dewatering during excavation: 1,500–5,000 ZMW/Item (lump sum per occurrence)
- Termite/pest treatment: 15,000–30,000 ZMW/Item

CONCRETE WORKS:
- Concrete Grade 15 (blinding/lean): 1,800–2,800 ZMW/m³ OR 1,000–2,000 ZMW/m² for standard 75mm blinding layer (Zambian practice often bills blinding per m²)
- Concrete Grade 25: 2,500–4,200 ZMW/m³
- Concrete Grade 30 (in-situ structural): 3,800–5,500 ZMW/m³ (common: ~4,800)
- Reinforcement bar Y10–Y32: 35–55 ZMW/kg
- R-bar (mild steel links/stirrups): 35–50 ZMW/kg
- BRC mesh A142–A252: 280–550 ZMW/m²
- Formwork (standard): 250–500 ZMW/m²

MASONRY & WALLING:
- Concrete hollow blocks 140mm: 300–450 ZMW/m²
- Concrete hollow blocks 200mm: 350–520 ZMW/m²
- Face/facing brick walling: 180–350 ZMW/m²
- Random rubble stone walling: 350–600 ZMW/m²
- Brickforce joint reinforcement: 8–18 ZMW/m

PLASTERWORK & FINISHES:
- Cement plaster internal: 120–220 ZMW/m²
- Cement plaster external: 150–280 ZMW/m²
- Ceramic floor tiles (supply & fix): 280–650 ZMW/m²
- Ceramic wall tiles (supply & fix): 250–600 ZMW/m²
- Tile skirting: 250–400 ZMW/m
- Surface bed edge strips/formwork: 30–60 ZMW/m
- DPM (polythene sheet): 40–80 ZMW/m²

ROOFING:
- IBR roofing sheets 0.5mm: 180–320 ZMW/m²
- Corrugated iron sheets: 150–280 ZMW/m²
- Timber purlins 76×50mm: 60–120 ZMW/lm
- Pre-fabricated roof trusses: 350–700 ZMW/m² (plan area)
- Fascia board: 80–160 ZMW/m
- Barge board: 80–160 ZMW/m
- Gutters & downpipes: 150–350 ZMW/m

STRUCTURAL STEEL:
- Steel columns/beams (fabricated & erected): 80–160 ZMW/kg
- Structural steel fabrication only: 60–120 ZMW/kg
- Bolts & connections (M16–M24): 200–400 ZMW/No.
- Steel base plates (fabricated): 80–160 ZMW/kg
- Anti-corrosion paint on steel: 40–80 ZMW/m²

DOORS & WINDOWS:
- Flush door hollow-core 900×2100mm: 2,500–5,000 ZMW each
- Flush door solid-core: 4,500–8,000 ZMW each
- Steel security door: 6,000–15,000 ZMW each
- Aluminium sliding window: 1,800–4,500 ZMW/m²
- Steel door frame (supply & fix): 1,500–4,000 ZMW each
- Door hardware (handle, hinges, lock set): 500–1,500 ZMW/set
- Air brick (ventilation): 30–60 ZMW/No.
- Minor ironmongery / bollards: 50–200 ZMW/Item

PLUMBING & DRAINAGE:
- uPVC soil pipe 110mm: 280–550 ZMW/lm
- uPVC waste pipe 50mm: 150–300 ZMW/lm
- PPR water supply pipe 20mm: 180–380 ZMW/lm
- WC suite (close-coupled, supply & fix): 4,500–9,000 ZMW each
- Wash basin including taps: 3,000–7,000 ZMW each
- PVC storm drain 160mm: 350–650 ZMW/lm
- Septic tank 1,500L prefab: 18,000–35,000 ZMW each
- Floor/inspection manholes: 2,000–6,000 ZMW each
- Copper PVC cable 2.5mm²: 1,500–2,500 ZMW/roll (100m roll)

ELECTRICAL:
- PVC conduit 20mm surface-mounted: 120–280 ZMW/lm
- Single socket outlet 13A (supply & fix): 180–400 ZMW each (common: ~280)
- Double socket outlet 13A: 300–600 ZMW each
- Single light switch: 180–350 ZMW each
- LED panel light fitting (supply & fix): 800–2,500 ZMW each
- Fluorescent batten fitting: 400–900 ZMW each
- Distribution board 8-way: 6,000–12,000 ZMW each
- Main distribution board 100A+: 12,000–20,000 ZMW each (common: ~15,000)
- Earthing & bonding (LS): 5,000–20,000 ZMW
- Cable tray/trunking: 200–500 ZMW/m

PAINTING & DECORATION:
- Emulsion paint 2 coats internal: 80–160 ZMW/m²
- External masonry paint 2 coats: 100–200 ZMW/m²
- Gloss paint on timber 2 coats: 120–220 ZMW/m²
- Anti-corrosion primer on steel: 40–80 ZMW/m²

RATE RULES:
1. Use conservative (lower-end) rates when scope or spec is unclear.
2. Set rate to null for: header rows, items with is_header=true, items where qty is also null.
3. Compute amount = qty × rate (round to 2 decimal places). Never leave amount null when both qty and rate are set.
4. All rates are in Zambian Kwacha (ZMW).
5. For preliminary items (mobilization, demobilization, site establishment) that are typically absorbed into other rates rather than priced separately, set rate to null and note to "Incl".`;

const RATES_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item_key: { type: SchemaType.STRING },
          rate: { type: SchemaType.NUMBER, nullable: true },
          amount: { type: SchemaType.NUMBER, nullable: true },
        },
        required: ["item_key"],
      },
    },
  },
  required: ["items"],
};

const BOQ_DOCUMENT_SCHEMA = {
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
                item_no: { type: SchemaType.STRING, nullable: true },
                description: { type: SchemaType.STRING },
                unit: { type: SchemaType.STRING, nullable: true },
                qty: { type: SchemaType.NUMBER, nullable: true },
                rate: { type: SchemaType.NUMBER, nullable: true },
                amount: { type: SchemaType.NUMBER, nullable: true },
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

const BOQ_VALIDATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    isValid: {
      type: SchemaType.BOOLEAN,
      description: "True if this spreadsheet is a genuine Bill of Quantities with item descriptions, units, and quantities",
    },
    totalItems: {
      type: SchemaType.NUMBER,
      description: "Total count of non-header line items detected in the spreadsheet",
    },
    missingRateCount: {
      type: SchemaType.NUMBER,
      description: "Count of non-header items that have a quantity but no rate (rate cell is empty or zero)",
    },
    rateColumnHeader: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Exact text of the column header for rates (e.g. 'Rate', 'Unit Rate', 'Rate (ZMW)'). Null if not found.",
    },
    amountColumnHeader: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Exact text of the column header for amounts/totals (e.g. 'Amount', 'Total', 'Amount (ZMW)'). Null if not found.",
    },
    errorMessage: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Human-readable reason if isValid=false. Null if valid.",
    },
  },
  required: ["isValid", "totalItems", "missingRateCount"],
};

type BOQValidationResult = {
  isValid: boolean;
  totalItems: number;
  missingRateCount: number;
  rateColumnHeader: string | null;
  amountColumnHeader: string | null;
  errorMessage: string | null;
};

/**
 * Validates whether an uploaded spreadsheet is a genuine BOQ,
 * and identifies the Rate and Amount column headers for later patching.
 */
export async function validateBOQ(csvText: string): Promise<BOQValidationResult> {
  const preview = csvText.slice(0, 8000);
  return generateStructuredContent<BOQValidationResult>({
    preferredModel: FALLBACK_MODEL,
    responseSchema: BOQ_VALIDATION_SCHEMA,
    temperature: 0,
    prompt: `Analyse the following spreadsheet data (CSV/table format) and determine whether it is a genuine Bill of Quantities (BOQ).

A valid BOQ has:
- A column for item descriptions/work items
- A column for units of measurement (m², m³, lm, No., LS, kg, etc.)
- A column for quantities
- Optionally a column for rates and/or amounts

Count all non-header line items and how many are missing rates.
Identify the EXACT text of the Rate column header and Amount column header (copy them verbatim from the data — do not paraphrase).

Spreadsheet data:
${preview}`,
  });
}

async function fillRatesPass(boq: BOQDocument): Promise<BOQDocument> {
  const allItems = boq.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header && item.rate === null)
      .map((item) => ({
        item_key: item.item_key ?? `${item.item_no || item.description.slice(0, 20)}`,
        description: item.description,
        unit: item.unit,
        qty: item.qty,
      }))
  );

  if (allItems.length === 0) return boq;

  const result = await generateStructuredContent<{ items: Array<{ item_key: string; rate: number | null; amount: number | null }> }>({
    preferredModel: PRIMARY_MODEL,
    responseSchema: RATES_SCHEMA,
    temperature: 0.1,
    systemInstruction: `You are a quantity surveyor estimating rates for a Zambian construction BOQ.\n\n${RATES_INSTRUCTION}`,
    prompt: `Estimate ZMW rates for the following BOQ items. Return rate and amount for each item_key.\n\n${JSON.stringify(allItems)}`,
  });

  const rateMap = new Map<string, { rate: number | null; amount: number | null }>();
  for (const r of result.items ?? []) {
    if (r.item_key) rateMap.set(r.item_key, { rate: r.rate ?? null, amount: r.amount ?? null });
  }

  return {
    ...boq,
    bills: boq.bills.map((bill) => ({
      ...bill,
      items: bill.items.map((item) => {
        if (item.is_header || item.rate !== null) return item;
        const itemKey = item.item_key ?? `${item.item_no || item.description.slice(0, 20)}`;
        const rateData = rateMap.get(itemKey);
        if (!rateData) return item;
        const rate = rateData.rate ?? null;
        const qty = item.qty;
        const amount = rateData.amount ?? (rate !== null && qty !== null ? +(qty * rate).toFixed(2) : null);
        return { ...item, rate, amount };
      }),
    })),
  };
}

export type RateContext = {
  province: string;        // e.g. "Lusaka", "Copperbelt", "Eastern"
  accessibility: string;  // "main_road" | "gravel_road" | "remote"
  labourSource: string;   // "local_unskilled" | "mixed" | "imported_skilled"
  equipment: string;      // "contractor_owned" | "mostly_hired"
  marginPct: number;       // e.g. 10, 15, 20
};

function buildRateContextBlock(ctx: RateContext): string {
  const accessibilityLabel =
    ctx.accessibility === "main_road" ? "Good access (main road) — standard transport costs" :
    ctx.accessibility === "gravel_road" ? "Gravel/secondary road — add 10–20% transport premium" :
    "Remote/bush site — add 25–40% transport premium on materials";

  const labourLabel =
    ctx.labourSource === "local_unskilled" ? "Mostly local unskilled labour available (use lower end of skilled rates)" :
    ctx.labourSource === "mixed" ? "Mix of local and imported skilled trades (use mid-range rates)" :
    "Mostly imported or specialist skilled labour required (use upper-end rates)";

  const equipmentLabel =
    ctx.equipment === "contractor_owned" ? "Contractor owns most equipment (exclude hire premium)" :
    "Most plant and equipment hired in (include plant hire margin in rates)";

  return `
SITE-SPECIFIC CONTEXT — adjust all rates accordingly:
- Province: ${ctx.province}
- Site accessibility: ${accessibilityLabel}
- Labour: ${labourLabel}
- Equipment: ${equipmentLabel}
- Target overhead & profit margin: ${ctx.marginPct}% (apply this markup on top of base rates)

Apply these adjustments consistently across all items. Transport-sensitive items (materials, concrete, steel) are most affected by accessibility.`.trim();
}

/**
 * Parses an Excel BOQ (provided as CSV text) and fills missing rates
 * using Zambian construction market rates, optionally adjusted for site context.
 */
export async function fillBOQRates(csvText: string, rateContext?: RateContext): Promise<BOQDocument> {
  const contextBlock = rateContext ? `\n\n${buildRateContextBlock(rateContext)}` : "";
  const truncated = csvText.length > 60000 ? csvText.slice(0, 60000) + "\n...[truncated]" : csvText;

  const raw = await generateStructuredContent<BOQDocument>({
    preferredModel: FALLBACK_MODEL,
    responseSchema: BOQ_DOCUMENT_SCHEMA,
    temperature: 0.1,
    thinkingBudget: 8000,
    systemInstruction: `You are a senior quantity surveyor parsing an Excel Bill of Quantities and filling missing rates.

${RATES_INSTRUCTION}${contextBlock}

PARSING RULES:
1. Parse the spreadsheet data into a structured BOQDocument JSON.
2. Preserve ALL items from the spreadsheet — do not drop any rows.
3. Preserve existing quantities, units, and descriptions verbatim.
4. Preserve any existing rates and amounts that are already filled in.
5. Fill in rates for items that have a quantity but no rate, using the Zambian market rates above.
6. Group items into bills based on the section headers in the spreadsheet.
7. If no section structure is visible, put all items into a single bill.
8. Set is_header=true for section header rows (rows with no qty/unit/rate).
9. Infer project name, location, and date from the spreadsheet if present; otherwise use reasonable placeholders.`,
    prompt: `Parse this BOQ spreadsheet and fill missing rates:\n\n${truncated}`,
  });

  // Normalise and ensure amounts are computed
  return {
    project: raw.project || "Uploaded BOQ",
    location: raw.location || "Zambia",
    prepared_by: raw.prepared_by || "BOQ Generator",
    date: raw.date || new Date().toISOString().slice(0, 10),
    bills: (raw.bills ?? []).map((bill, billIdx) => ({
      number: bill.number ?? billIdx + 1,
      title: bill.title || `Bill ${billIdx + 1}`,
      items: (bill.items ?? []).map((item) => {
        const qty = typeof item.qty === "number" && isFinite(item.qty) && item.qty > 0 ? item.qty : null;
        const rate = typeof item.rate === "number" && isFinite(item.rate) && item.rate > 0 ? item.rate : null;
        const amount = typeof item.amount === "number" && isFinite(item.amount) && item.amount > 0
          ? item.amount
          : (qty !== null && rate !== null ? +(qty * rate).toFixed(2) : null);
        return {
          item_no: item.item_no ?? "",
          description: item.description || "Unspecified item",
          unit: item.unit || "Item",
          qty,
          rate,
          amount,
          is_header: item.is_header ?? false,
          note: item.note ?? undefined,
        };
      }),
    })),
    pipeline_version: "excel-rate-v1.0",
  };
}

export async function generateBOQ(
  input: string | GenerationInputBundle,
  opts?: {
    suggestRates?: boolean;
    documentClassification?: DocumentClassification;
  }
): Promise<BOQDocument> {
  const documents =
    typeof input === "string"
      ? [
          {
            document_id: "primary",
            name: "Primary SOW",
            role: "primary" as const,
            document_type: "construction_sow" as const,
            text: input,
            pages: null,
          },
        ]
      : input.documents;
  const bundleText = buildPromptBundle(documents);

  const structureRaw = await generateStructure(bundleText, false);
  let structure = normalizeStructure(structureRaw);

  if (countNonHeaderItems(structure) === 0) {
    const retryRaw = await generateStructure(bundleText, true);
    structure = normalizeStructure(retryRaw);
  }

  if (countNonHeaderItems(structure) === 0) {
    throw new Error(
      "Could not extract BOQ structure from SOW (no measurable items found). Please upload a clearer scope document."
    );
  }

  const quantitiesRaw = applyDrawingCountHeuristics(
    structure,
    await extractQuantities(bundleText, structure),
    documents
  );
  const boq = mergeStructureAndQuantities(
    structure,
    quantitiesRaw,
    opts?.documentClassification,
    buildSourceBundle(documents)
  );
  if (opts?.suggestRates) {
    return fillRatesPass(boq);
  }
  return boq;
}

function mergeStructureAndQuantities(
  structure: BOQStructureArtifact,
  quantities: QuantityPassResponse,
  documentClassification?: DocumentClassification,
  sourceBundle?: SourceBundleDocument[]
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
      source_document: safeNullableText(item.source_document),
      evidence_type: normalizeEvidenceType(item.evidence_type, item.source_excerpt, item.qty),
      derivation_note: safeNullableText(item.derivation_note),
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
    items: (() => {
      const mergedItems: BOQItem[] = [];
      let currentSection: string | null = null;

      for (const baseItem of bill.items) {
        if (!baseItem.is_header && baseItem.section_context) {
          const normalizedSection = safeText(baseItem.section_context, "").trim();
          if (normalizedSection && normalizedSection !== currentSection) {
            currentSection = normalizedSection;
            mergedItems.push({
              item_key: `${baseItem.item_key}_section`,
              item_no: "",
              description: normalizedSection,
              unit: "",
              qty: null,
              rate: null,
              amount: null,
              is_header: true,
            });
          }
        }

        if (baseItem.is_header) {
          currentSection = baseItem.description;
          mergedItems.push({
            item_key: baseItem.item_key,
            item_no: "",
            description: baseItem.description,
            unit: "",
            qty: null,
            rate: null,
            amount: null,
            is_header: true,
          });
          continue;
        }

        totalItems += 1;
        const q = quantityMap.get(baseItem.item_key);
        let qty = q?.qty ?? null;
        let source = q?.quantity_source ?? "assumed";
        const confidence = q?.quantity_confidence ?? 0.4;
        const excerpt = q?.source_excerpt ?? null;
        const anchor = q?.source_anchor ?? null;
        const sourceDocument = q?.source_document ?? null;

        if (qty !== null && !hasSufficientEvidence(excerpt)) {
          validationFlags.push({
            item_key: baseItem.item_key,
            issue: "missing_evidence",
            severity: "warning",
            code: "QTY_EVIDENCE_REQUIRED",
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
            code: "QTY_INVALID_VALUE",
            message: "Invalid quantity value was discarded.",
          });
        }

        if (qty === null) {
          qtyMissing += 1;
          validationFlags.push({
            item_key: baseItem.item_key,
            issue: "missing_quantity",
            severity: "info",
            code: "QTY_UNRESOLVED",
            message: "Quantity is unresolved and requires manual review.",
          });
        } else if (hasSufficientEvidence(excerpt)) {
          qtyWithEvidence += 1;
        }

        if (confidence < 0.6) {
          lowConfidence += 1;
        }

        mergedItems.push({
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
          source_document: sourceDocument,
          evidence_type: q?.evidence_type ?? "missing",
          derivation_note: q?.derivation_note ?? null,
          note: q?.note ?? baseItem.note,
        });
      }

      return mergedItems;
    })(),
  }));

  const qualitySummary: BOQQualitySummary = {
    total_items: totalItems,
    qty_with_evidence: qtyWithEvidence,
    qty_missing: qtyMissing,
    low_confidence: lowConfidence,
    semantic_risk_items: bills
      .flatMap((bill) => bill.items)
      .filter((item) => !item.is_header && item.evidence_type === "missing").length,
    evidence_coverage_ratio:
      totalItems > 0 ? Number((qtyWithEvidence / totalItems).toFixed(2)) : 0,
    source_bundle_status: documentClassification?.source_bundle_status ?? "complete",
    missing_required_attachments: documentClassification?.required_attachments.length ?? 0,
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
    pipeline_version: "quantity-v2.0",
    document_classification: documentClassification,
    source_bundle: sourceBundle,
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

function normalizeEvidenceType(
  evidenceType: string | BOQEvidenceType | null | undefined,
  excerpt: string | null | undefined,
  qty: number | null
): BOQEvidenceType {
  const clean = (evidenceType ?? "").toLowerCase();
  if (
    clean === "quoted_scope" ||
    clean === "tabulated_scope" ||
    clean === "derived_calculation" ||
    clean === "metadata_only" ||
    clean === "missing"
  ) {
    return clean;
  }
  if (qty == null || !excerpt?.trim()) return "missing";
  return "quoted_scope";
}

export function hasSufficientEvidence(excerpt: string | null): boolean {
  if (!excerpt) return false;
  return excerpt.trim().length >= 12;
}
