import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus: "ok" | "error" = "error";

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("boqs").select("id").limit(1);
    if (!error) dbStatus = "ok";
  } catch {
    // dbStatus stays "error"
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), db: dbStatus },
    { status: dbStatus === "ok" ? 200 : 503 }
  );
}
