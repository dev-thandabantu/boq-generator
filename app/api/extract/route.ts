import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { validateSOW } from "@/lib/claude";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

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
      const data = await pdfParse(buffer);
      text = data.text;
      pages = data.numpages;
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
    let sowFlags: string[] = [];
    try {
      const validation = await validateSOW(text);
      isSOW = validation.isSOW;
      sowConfidence = validation.confidence;
      documentType = validation.documentType;
      sowFlags = validation.flags ?? [];
      if (!isSOW) {
        sowWarning = validation.reason;
      }
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
      sowFlags,
    });
  } catch (err) {
    console.error("Extraction error:", err);
    return NextResponse.json(
      { error: "Failed to extract text from the document. Please try again." },
      { status: 500 }
    );
  }
}
