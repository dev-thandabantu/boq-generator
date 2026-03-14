import { readFileSync } from "fs";
import { join } from "path";

export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations");
    return;
  }
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      const sql = readFileSync(
        join(process.cwd(), "supabase/migrations/001_initial.sql"),
        "utf8"
      );
      await pool.query(sql);
      console.log("[migrate] Schema up to date");
    } finally {
      await pool.end();
    }
  } catch (err) {
    // Non-fatal — app still works, but log clearly
    console.error("[migrate] Migration error:", err);
  }
}
