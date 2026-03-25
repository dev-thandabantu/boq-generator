-- ============================================================
-- 005: Affiliate & referral program tables
-- ============================================================

-- ── Affiliates ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.affiliates (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code        TEXT        NOT NULL UNIQUE,
  payout_email         TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  -- status: 'pending' | 'active' | 'suspended'
  commission_type      TEXT        NOT NULL DEFAULT 'fixed',
  -- commission_type: 'fixed' (cents) | 'percent' (basis points, e.g. 1000 = 10%)
  commission_value     INTEGER     NOT NULL DEFAULT 500,
  total_earned_cents   INTEGER     NOT NULL DEFAULT 0,
  total_paid_cents     INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliates_status_check
    CHECK (status IN ('pending', 'active', 'suspended')),
  CONSTRAINT affiliates_commission_type_check
    CHECK (commission_type IN ('fixed', 'percent'))
);

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='affiliates' AND policyname='affiliates_select_own') THEN
    CREATE POLICY affiliates_select_own ON public.affiliates
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='affiliates' AND policyname='affiliates_update_own') THEN
    CREATE POLICY affiliates_update_own ON public.affiliates
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='affiliates' AND policyname='affiliates_insert_service') THEN
    CREATE POLICY affiliates_insert_service ON public.affiliates
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS affiliates_set_updated_at ON public.affiliates;
CREATE TRIGGER affiliates_set_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Referrals ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referrals (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id      UUID        NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referred_user_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  payment_id        UUID        REFERENCES public.payments(id) ON DELETE SET NULL,
  commission_cents  INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'pending',
  -- status: 'pending' | 'confirmed' | 'paid'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_status_check
    CHECK (status IN ('pending', 'confirmed', 'paid'))
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referrals' AND policyname='referrals_select_own') THEN
    CREATE POLICY referrals_select_own ON public.referrals
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.affiliates a
          WHERE a.id = affiliate_id AND a.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referrals' AND policyname='referrals_insert_service') THEN
    CREATE POLICY referrals_insert_service ON public.referrals
      FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referrals' AND policyname='referrals_update_service') THEN
    CREATE POLICY referrals_update_service ON public.referrals
      FOR UPDATE USING (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS referrals_set_updated_at ON public.referrals;
CREATE TRIGGER referrals_set_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS affiliates_referral_code_idx ON public.affiliates(referral_code);
CREATE INDEX IF NOT EXISTS affiliates_user_id_idx       ON public.affiliates(user_id);
CREATE INDEX IF NOT EXISTS referrals_affiliate_id_idx   ON public.referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS referrals_referred_user_idx  ON public.referrals(referred_user_id);

-- ── Helper function: atomic increment of affiliate earned balance ─────────────

CREATE OR REPLACE FUNCTION public.increment_affiliate_earned(
  p_affiliate_id UUID,
  p_amount       INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.affiliates
  SET total_earned_cents = total_earned_cents + p_amount,
      updated_at         = NOW()
  WHERE id = p_affiliate_id;
END;
$$;
