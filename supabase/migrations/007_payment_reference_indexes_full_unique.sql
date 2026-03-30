-- ============================================================
-- 007: Replace partial payment reference indexes with full unique indexes
-- Supabase/PostgREST upsert on onConflict=payment_reference expects
-- a plain unique index/constraint it can target reliably.
-- ============================================================

DROP INDEX IF EXISTS public.boqs_payment_reference_key;
DROP INDEX IF EXISTS public.payments_payment_reference_key;

CREATE UNIQUE INDEX IF NOT EXISTS boqs_payment_reference_key
  ON public.boqs(payment_reference);

CREATE UNIQUE INDEX IF NOT EXISTS payments_payment_reference_key
  ON public.payments(payment_reference);
