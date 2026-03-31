-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS boqs_user_id_idx      ON public.boqs(user_id);
CREATE INDEX IF NOT EXISTS boqs_created_at_idx   ON public.boqs(created_at DESC);
CREATE INDEX IF NOT EXISTS payments_user_id_idx  ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS payments_boq_id_idx   ON public.payments(boq_id);
