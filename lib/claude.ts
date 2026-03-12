import Anthropic from "@anthropic-ai/sdk";
import type { BOQDocument } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const BOQ_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "Full project name" },
    location: { type: "string", description: "Project location/site" },
    prepared_by: { type: "string", description: "Company or person preparing the BOQ" },
    date: { type: "string", description: "Date in DD/MM/YYYY format" },
    bills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "number" },
          title: { type: "string", description: "Bill title e.g. PRELIMINARY AND GENERAL ITEMS" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_no: { type: "string", description: "Item number: A, B, C or 1.1, 1.2 or blank for headers" },
                description: { type: "string", description: "Full technical work description" },
                unit: {
                  type: "string",
                  description: "Measurement unit: m, m², m³, No., Item, LS, kg, etc.",
                },
                qty: { type: ["number", "null"], description: "Quantity — null if not specified" },
                rate: { type: ["number", "null"], description: "Always null — engineer will price" },
                amount: { type: ["number", "null"], description: "Always null for new BOQs" },
                is_header: {
                  type: "boolean",
                  description: "True if this row is a section header with no quantities",
                },
                note: {
                  type: ["string", "null"],
                  description: "Special notes like Incl or Rate only",
                },
              },
              required: ["item_no", "description", "unit", "qty", "rate", "amount"],
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
11. Include standard preliminary items even if not explicitly stated (Setting out, Insurances, Site clearing, Temporary works, etc.)
12. Number items within each bill using letters (A, B, C...) for simple bills, or decimal (1.1, 1.2...) for complex ones
13. The date should be today's date if not specified in the document`;

export async function generateBOQ(sowText: string): Promise<BOQDocument> {
  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "create_boq",
        description: "Create a structured Bill of Quantities from the Scope of Work",
        input_schema: BOQ_SCHEMA as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Please extract a complete Bill of Quantities from this Scope of Work document:\n\n${sowText}`,
      },
    ],
  });

  const toolUse = message.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured BOQ");
  }

  return toolUse.input as BOQDocument;
}
