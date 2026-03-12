import { NextRequest, NextResponse } from "next/server";
import { generateBOQ } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body as { text: string };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (text.length < 50) {
      return NextResponse.json(
        { error: "Text too short — could not extract meaningful content from PDF" },
        { status: 400 }
      );
    }

    // Truncate to ~80k chars to stay within token limits
    const truncated = text.length > 80000 ? text.slice(0, 80000) + "\n...[truncated]" : text;

    const boq = await generateBOQ(truncated);

    return NextResponse.json({ boq });
  } catch (err) {
    console.error("BOQ generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate BOQ: ${message}` },
      { status: 500 }
    );
  }
}
