-- ════════════════════════════════════════════════════════════════════════════
-- LinkPilot AI — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  google_id               TEXT        UNIQUE NOT NULL,
  email                   TEXT,
  name                    TEXT,
  avatar_url              TEXT,
  plan                    TEXT        DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  plan_expires_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  last_seen_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (Edge Functions use service role)
CREATE POLICY "service_role_all" ON public.users
  FOR ALL USING (true) WITH CHECK (true);

-- ── Usage Events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_events (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,  -- 'analysis' | 'message' | 'post'
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.usage_events
  FOR ALL USING (true) WITH CHECK (true);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_google_id          ON public.users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer    ON public.users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_id            ON public.usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at         ON public.usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_event_month   ON public.usage_events(user_id, event_type, created_at);
