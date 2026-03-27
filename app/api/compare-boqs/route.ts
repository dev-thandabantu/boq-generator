import { NextRequest, NextResponse } from "next/server";
import { compareBOQs } from "@/lib/boq-compare";
import type { BOQDocument } from "@/lib/types";

export const runtime = "nodejs";

type CompareRequest = {
  baseline_boq?: BOQDocument;
  candidate_boq?: BOQDocument;
  baseline_label?: string;
  candidate_label?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CompareRequest;
    if (!body.baseline_boq || !body.candidate_boq) {
      return NextResponse.json(
        { error: "baseline_boq and candidate_boq are required" },
        { status: 400 }
      );
    }

    const report = compareBOQs(body.baseline_boq, body.candidate_boq, {
      baseline: body.baseline_label,
      candidate: body.candidate_label,
    });

    return NextResponse.json({ comparison: report });
  } catch {
    return NextResponse.json(
      { error: "Could not compare the supplied BOQs" },
      { status: 500 }
    );
  }
}
