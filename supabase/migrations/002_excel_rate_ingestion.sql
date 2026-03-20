-- ============================================================
-- Migration 002: Excel rate ingestion support
-- Adds columns to boqs table for tracking source Excel files
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS source_excel_key   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rate_col_header     TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amount_col_header   TEXT    DEFAULT NULL;

COMMENT ON COLUMN public.boqs.source_excel_key   IS 'Supabase Storage path of the original uploaded Excel BOQ (e.g. pending/uuid.xlsx)';
COMMENT ON COLUMN public.boqs.rate_col_header     IS 'Exact Rate column header text from the uploaded Excel (for patching)';
COMMENT ON COLUMN public.boqs.amount_col_header   IS 'Exact Amount column header text from the uploaded Excel (for patching)';
