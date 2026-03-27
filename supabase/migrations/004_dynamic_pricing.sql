-- ============================================================
-- 004: Dynamic pricing columns on boqs
-- Adds payment_status + grand_total_zmw; backfills existing rows
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS payment_status  TEXT          NOT NULL DEFAULT 'preview',
  ADD COLUMN IF NOT EXISTS grand_total_zmw NUMERIC(15,2);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_payment_status_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_payment_status_check
        CHECK (payment_status IN ('preview', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS boqs_payment_status_idx ON public.boqs(payment_status);

-- Backfill: any BOQ that has a completed payment is already paid
UPDATE public.boqs b
SET payment_status = 'paid'
WHERE payment_status = 'preview'
  AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.boq_id = b.id AND p.status = 'completed'
  );
