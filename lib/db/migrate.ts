import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";

export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL not set — skipping migrations");
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
      logger.info("DB schema up to date");
    } finally {
      await pool.end();
    }
  } catch (err) {
    // Non-fatal — app still works, but log clearly
    logger.error("Migration error", { error: err instanceof Error ? err.message : String(err) });
  }
}
