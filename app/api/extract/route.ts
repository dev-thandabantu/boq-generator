import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import { validateSOW } from "@/lib/claude";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: { pagerender?: (pageData: { getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => Promise<string> }
) => Promise<{ text: string; numpages: number }>;

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB
const MIN_DIRECT_TEXT_LENGTH = 120;
const GEMINI_VISION_MODELS = [
  process.env.GEMINI_MODEL_FALLBACK,
  process.env.GEMINI_MODEL_PRIMARY,
  "gemini-2.5-flash",
].filter(Boolean) as string[];

function getVisionClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenerativeAI(key);
}

async function extractPdfTextWithVision(buffer: Buffer, filename: string) {
  const client = getVisionClient();
  let lastError: unknown;

  for (const modelName of Array.from(new Set(GEMINI_VISION_MODELS))) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction:
          "You extract visible text and drawing labels from scanned construction PDFs. Return plain text only. Preserve page order, dimensions, room names, notes, legends, schedules, and title-block details when visible. Do not add commentary.",
        generationConfig: {
          temperature: 0,
        },
      });

      const result = await model.generateContent([
        {
          text:
            "Extract all readable visible text from this PDF. This may be a construction drawing or scanned document. Return plain text only. Include page markers like [PAGE 1]. If text is sparse, still return whatever labels, dimensions, title block fields, schedules, callouts, and notes are visible.",
        },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: buffer.toString("base64"),
          },
        },
      ]);

      const text = result.response.text().trim();
      if (text.length > 0) {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Vision extraction failed for ${filename}`);
}

function createPageRender() {
  let pageNumber = 0;
  return async (pageData: {
    getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
  }) => {
    pageNumber += 1;
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    let lastY: number | undefined;
    let text = `\n[PAGE ${pageNumber}]\n`;

    for (const item of textContent.items) {
      if (lastY === item.transform[5] || typeof lastY === "undefined") {
        text += item.str;
      } else {
        text += `\n${item.str}`;
      }
      lastY = item.transform[5];
    }

    return `${text}\n`;
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const supportingDocsCount = Number(formData.get("supporting_docs_count") ?? 0);

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const isPDF = name.endsWith(".pdf");
    const isDOCX = name.endsWith(".docx");

    if (!isPDF && !isDOCX) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or Word (.docx) document." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let text = "";
    let pages: number | null = null;

    if (isPDF) {
      // Verify PDF magic bytes
      if (buffer[0] !== 0x25 || buffer[1] !== 0x50) {
        return NextResponse.json({ error: "Invalid PDF file" }, { status: 400 });
      }
      const data = await pdfParse(buffer, { pagerender: createPageRender() });
      text = data.text;
      pages = data.numpages;

      const trimmedText = text.trim();
      if (trimmedText.length < MIN_DIRECT_TEXT_LENGTH) {
        try {
          const visionText = await extractPdfTextWithVision(buffer, file.name);
          if (visionText.trim().length > trimmedText.length) {
            text = visionText;
          }
        } catch (visionError) {
          console.warn("Vision fallback extraction failed:", visionError);
        }
      }
    } else {
      // .docx via mammoth
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      pages = null; // Word docs don't have a reliable page count at extraction time
    }

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        {
          error: isPDF
            ? "Could not extract text from this PDF. It may be a scanned image — please use a text-based PDF."
            : "Could not extract text from this Word document. Please ensure it contains readable text.",
        },
        { status: 400 }
      );
    }

    // Quick SOW validation (uses first ~3 000 chars for speed)
    let isSOW = true;
    let sowWarning: string | null = null;
    let sowConfidence: number | null = null;
    let documentType: string | null = null;
    let shouldBlockGeneration = false;
    let positiveSignals: string[] = [];
    let negativeSignals: string[] = [];
    let sowFlags: string[] = [];
    try {
      const validation = await validateSOW(text, { supportingDocsCount });
      isSOW = validation.isSOW;
      sowConfidence = validation.confidence;
      documentType = validation.documentType;
      shouldBlockGeneration = validation.should_block_generation;
      const requiredAttachments = validation.required_attachments ?? [];
      const sourceBundleStatus = validation.source_bundle_status ?? "complete";
      positiveSignals = validation.positive_signals ?? [];
      negativeSignals = validation.negative_signals ?? [];
      sowFlags = validation.flags ?? [];
      if (!isSOW) {
        sowWarning = validation.reason;
      }
      return NextResponse.json({
        text,
        pages,
        isSOW,
        sowWarning,
        sowConfidence,
        documentType,
        shouldBlockGeneration,
        requiredAttachments,
        sourceBundleStatus,
        positiveSignals,
        negativeSignals,
        sowFlags,
      });
    } catch {
      // Non-fatal — proceed without validation result
    }

    return NextResponse.json({
      text,
      pages,
      isSOW,
      sowWarning,
      sowConfidence,
      documentType,
      shouldBlockGeneration,
      requiredAttachments: [],
      sourceBundleStatus: "complete",
      positiveSignals,
      negativeSignals,
      sowFlags,
    });
  } catch (err) {
    logger.error("Extraction error", { error: err instanceof Error ? err.message : String(err), route: "extract" });
    return NextResponse.json(
      { error: "Failed to extract text from the document. Please try again." },
      { status: 500 }
    );
  }
}
