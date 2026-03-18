import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { BOQDocument } from "./types";

const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-flash";
const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.0-flash";
const MAX_ATTEMPTS_PER_MODEL = 3;

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

const BOQ_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    project: { type: SchemaType.STRING, description: "Full project name" },
    location: { type: SchemaType.STRING, description: "Project location/site" },
    prepared_by: { type: SchemaType.STRING, description: "Company or person preparing the BOQ" },
    date: { type: SchemaType.STRING, description: "Date in DD/MM/YYYY format" },
    bills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          number: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING, description: "Bill title e.g. PRELIMINARY AND GENERAL ITEMS" },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                item_no: { type: SchemaType.STRING, description: "Item number: A, B, C or 1.1, 1.2 or blank for headers" },
                description: { type: SchemaType.STRING, description: "Full technical work description" },
                unit: { type: SchemaType.STRING, description: "Measurement unit: m, m², m³, No., Item, LS, kg, etc." },
                qty: { type: SchemaType.NUMBER, nullable: true, description: "Quantity — null if not specified" },
                rate: { type: SchemaType.NUMBER, nullable: true, description: "Always null — engineer will price" },
                amount: { type: SchemaType.NUMBER, nullable: true, description: "Always null for new BOQs" },
                is_header: { type: SchemaType.BOOLEAN, description: "True if this row is a section header with no quantities" },
                note: { type: SchemaType.STRING, nullable: true, description: "Special notes like Incl or Rate only" },
              },
              required: ["item_no", "description", "unit"],
            },
          },
        },
        required: ["number", "title", "items"],
      },
    },
  },
  required: ["project", "location", "prepared_by", "date", "bills"],
};

const SYSTEM_PROMPT = `You are an expert quantity surveyor with 20+ years of experience in Southern African construction, specialising in Zambian infrastructure projects.

Your task is to extract a structured Bill of Quantities (BOQ) from a Scope of Work (SOW) document.

RULES:
1. Always create a "PRELIMINARY AND GENERAL ITEMS" bill first (Bill No. 1)
2. Group remaining items into logical bills by trade/discipline (Earthworks, Concrete Works, Structural Steel, Pipe Works, Electrical, etc.)
3. Use standard Zambian BOQ units: m (linear meters), m² (square meters), m³ (cubic meters), No. (number/count), Item (single item), LS (lump sum), kg (kilograms), t (tonnes)
4. Leave rate and amount as null — the engineer will price these
5. Extract explicit quantities from the SOW text where stated (e.g. "120m of pipe" → qty: 120, unit: "m")
6. For items without explicit quantities, set qty: 1, unit: "Item" or "LS"
7. Descriptions must be technically precise and follow standard BOQ language
8. Start descriptions with action verbs: Supply, Install, Excavate, Cast, Allow for, Provide, Lay, Fix, etc.
9. Include material specifications, dimensions, and standards where mentioned
10. Add is_header: true for subsection titles within a bill (no item_no, no qty)
11. Bill No. 1 (PRELIMINARY AND GENERAL ITEMS) must always include at minimum:
    - "Allow for mobilisation, including but not limited to preparation, transportation and erecting constructional plant, equipment, offices and preparatory works in commencing the execution of the works." (unit: LS, qty: 1)
    - "Allow for demobilisation, including but not limited to removing and shipping construction plant and equipment, returning staff, removing temporary works, and cleaning the site as specified by the site Engineer." (unit: LS, qty: 1)
    Add further preliminary items as appropriate to the project scope (setting out, site security, temporary works, insurances, progress photos, etc.)
12. Number items using bill-prefixed decimals: Bill No. 1 items are 1.1, 1.2, 1.3 etc.; Bill No. 2 items are 2.1, 2.2, 2.3 etc.; and so on for all bills
13. Use is_header: true for subsection group labels within a bill (e.g. "EARTHWORKS", "CONCRETE WORKS") — these have no item_no, no qty, no unit
14. The date should be today's date if not specified in the document`;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("temporar") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("429") ||
    msg.includes("quota")
  );
}

async function generateWithModel(modelName: string, sowText: string): Promise<BOQDocument> {
  const model = getGenAI().getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: BOQ_RESPONSE_SCHEMA as any,
      temperature: 0.2,
    },
  });

  const result = await model.generateContent(
    `Please extract a complete Bill of Quantities from this Scope of Work document:\n\n${sowText}`
  );

  const text = result.response.text();
  const boq = JSON.parse(text) as BOQDocument;

  if (!boq.bills || !Array.isArray(boq.bills)) {
    throw new Error("Gemini did not return a valid BOQ structure");
  }

  return boq;
}

export async function generateBOQ(sowText: string): Promise<BOQDocument> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter(
    (value, index, arr) => Boolean(value) && arr.indexOf(value) === index
  );

  let lastError: unknown;

  for (const modelName of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        return await generateWithModel(modelName, sowText);
      } catch (err) {
        lastError = err;
        if (!isTransientGeminiError(err)) {
          throw err;
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS_PER_MODEL;
        if (!isLastAttempt) {
          const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 4000);
          await delay(backoffMs);
        }
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(`Gemini temporarily unavailable after retries: ${lastError.message}`)
    : new Error("Gemini temporarily unavailable after retries");
}
