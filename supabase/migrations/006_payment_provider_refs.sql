-- ============================================================
-- 006: Generic payment provider references
-- Adds provider-agnostic payment reference columns so production
-- can use Flutterwave while keeping Stripe data intact.
-- ============================================================

ALTER TABLE public.boqs
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_processor_reference TEXT;

UPDATE public.boqs
SET
  payment_provider = COALESCE(payment_provider, 'stripe'),
  payment_reference = COALESCE(payment_reference, stripe_session_id)
WHERE stripe_session_id IS NOT NULL;

UPDATE public.payments
SET
  payment_provider = COALESCE(payment_provider, 'stripe'),
  payment_reference = COALESCE(payment_reference, stripe_session_id),
  payment_processor_reference = COALESCE(payment_processor_reference, stripe_payment_intent)
WHERE stripe_session_id IS NOT NULL;

ALTER TABLE public.payments
  ALTER COLUMN stripe_session_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boqs_payment_provider_check'
  ) THEN
    ALTER TABLE public.boqs
      ADD CONSTRAINT boqs_payment_provider_check
        CHECK (payment_provider IS NULL OR payment_provider IN ('stripe', 'flutterwave'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_provider_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_payment_provider_check
        CHECK (payment_provider IS NULL OR payment_provider IN ('stripe', 'flutterwave'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS boqs_payment_reference_key
  ON public.boqs(payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_payment_reference_key
  ON public.payments(payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS boqs_payment_provider_idx
  ON public.boqs(payment_provider);

CREATE INDEX IF NOT EXISTS payments_payment_provider_idx
  ON public.payments(payment_provider);
