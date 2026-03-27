import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateBOQ } from "@/lib/claude";
import { excelToCSV } from "@/lib/excel";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";
import { getTierForItemCount, loadRateTiers } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (storage bucket limit)
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "boq-generator-dev";

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse multipart form
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Please upload an Excel file (.xlsx or .xls)" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 400 }
      );
    }

    // Read file bytes
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Convert to CSV for Gemini analysis
    let csvText: string;
    try {
      csvText = excelToCSV(buffer);
    } catch {
      return NextResponse.json(
        { error: "Could not read the Excel file. Please check it is not password-protected or corrupted." },
        { status: 400 }
      );
    }

    if (csvText.trim().length < 30) {
      return NextResponse.json(
        { error: "The spreadsheet appears to be empty or has no readable content." },
        { status: 400 }
      );
    }

    // Full Gemini validation — detect if this is a genuine BOQ
    const validation = await validateBOQ(csvText);

    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: validation.errorMessage ||
            "This spreadsheet does not appear to be a Bill of Quantities. Please upload a BOQ with item descriptions, units, and quantities.",
        },
        { status: 400 }
      );
    }

    // Upload original Excel to Supabase Storage using service role client (no RLS on bucket)
    const serviceClient = createServiceClient();
    const storageKey = `pending/${randomUUID()}.xlsx`;

    const { error: uploadError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .upload(storageKey, buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });

    if (uploadError) {
      logger.error("Storage upload error", { error: String(uploadError), route: "ingest-boq" });
      return NextResponse.json(
        { error: "Failed to store the uploaded file. Please try again." },
        { status: 500 }
      );
    }

    // Compute pricing tier based on item count (no rates to sum yet)
    const rateTiers = loadRateTiers();
    const pricingTier = getTierForItemCount(validation.totalItems ?? 0, rateTiers);

    // Save a preview BOQ row so the boq_id can be passed through checkout → rate-boq
    const { data: previewBoq, error: dbError } = await serviceClient
      .from("boqs")
      .insert({
        user_id: user.id,
        title: file.name.replace(/\.[^/.]+$/, "") || "Untitled BOQ",
        data: {},           // placeholder — filled by rate-boq after payment
        payment_status: "preview",
        source_excel_key: storageKey,
        rate_col_header: validation.rateColumnHeader ?? null,
        amount_col_header: validation.amountColumnHeader ?? null,
      })
      .select("id")
      .single();

    if (dbError) {
      logger.error("Failed to save preview BOQ for rate_boq", { error: String(dbError), route: "ingest-boq" });
      // Non-fatal: return without boq_id; checkout will fall back to legacy flow
    }

    trackEvent(user.id, "excel_ingested", {
      totalItems: validation.totalItems,
      missingRateCount: validation.missingRateCount,
      pricingTier: pricingTier.label,
      amountCents: pricingTier.usdCents,
    });

    return NextResponse.json({
      storageKey,
      boq_id: previewBoq?.id ?? null,
      amountCents: pricingTier.usdCents,
      preview: {
        totalItems: validation.totalItems,
        missingRateCount: validation.missingRateCount,
        rateColumnHeader: validation.rateColumnHeader,
        amountColumnHeader: validation.amountColumnHeader,
      },
    });
  } catch (err) {
    logger.error("ingest-boq error", { error: err instanceof Error ? err.message : String(err), route: "ingest-boq" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
