-- ============================================================
-- BOQ Generator — initial schema (idempotent, safe to re-run)
-- ============================================================

-- Profiles (linked 1:1 to auth.users, auto-created on signup)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_select_own') THEN
    CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- BOQs
CREATE TABLE IF NOT EXISTS public.boqs (
  id                UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title             TEXT         NOT NULL DEFAULT 'Untitled BOQ',
  data              JSONB        NOT NULL,
  stripe_session_id TEXT         UNIQUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.boqs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boqs' AND policyname='boqs_select_own') THEN
    CREATE POLICY boqs_select_own ON public.boqs FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boqs' AND policyname='boqs_update_own') THEN
    CREATE POLICY boqs_update_own ON public.boqs FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boqs' AND policyname='boqs_delete_own') THEN
    CREATE POLICY boqs_delete_own ON public.boqs FOR DELETE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boqs' AND policyname='boqs_insert_service') THEN
    CREATE POLICY boqs_insert_service ON public.boqs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Updated_at auto-update
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boqs_set_updated_at ON public.boqs;
CREATE TRIGGER boqs_set_updated_at
  BEFORE UPDATE ON public.boqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  stripe_session_id      TEXT        NOT NULL UNIQUE,
  stripe_payment_intent  TEXT,
  amount_cents           INTEGER     NOT NULL DEFAULT 10000,
  currency               TEXT        NOT NULL DEFAULT 'usd',
  status                 TEXT        NOT NULL DEFAULT 'pending',
  boq_id                 UUID        REFERENCES public.boqs(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='payments_select_own') THEN
    CREATE POLICY payments_select_own ON public.payments FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='payments_insert_service') THEN
    CREATE POLICY payments_insert_service ON public.payments FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='payments_update_service') THEN
    CREATE POLICY payments_update_service ON public.payments FOR UPDATE USING (true);
  END IF;
END $$;
