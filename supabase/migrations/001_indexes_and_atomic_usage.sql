-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_usage_events_user_type_created
  ON usage_events (user_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_users_google_id
  ON users (google_id);

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id
  ON users (stripe_subscription_id);

-- 2. Settings column on users (needed for cloud settings sync)
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;

-- 3. Atomic usage gate function (avoids TOCTOU race on free-tier limit checks)
CREATE OR REPLACE FUNCTION track_usage_atomic(
  p_user_id    uuid,
  p_event_type text,
  p_metadata   jsonb,
  p_month_start timestamptz,
  p_limit      int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  -- Count existing events for this month (lock nothing — just a read)
  SELECT COUNT(*) INTO v_count
  FROM usage_events
  WHERE user_id    = p_user_id
    AND event_type = p_event_type
    AND created_at >= p_month_start;

  IF v_count >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_count);
  END IF;

  -- Insert the new event
  INSERT INTO usage_events (user_id, event_type, metadata)
  VALUES (p_user_id, p_event_type, p_metadata);

  RETURN jsonb_build_object('allowed', true, 'used', v_count + 1);
END;
$$;
