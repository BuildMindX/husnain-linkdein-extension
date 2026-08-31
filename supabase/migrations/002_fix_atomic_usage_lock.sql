-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Fixes a real concurrency gap in track_usage_atomic() from 001: despite the function's own
-- comment claiming it "avoids TOCTOU race," the count-check-then-insert had no lock or
-- serializable isolation between them. Two genuinely concurrent calls for the same user+event
-- (two open tabs, a fast double-click firing two requests before the first round-trip returns)
-- could both read the same count under READ COMMITTED before either committed its insert,
-- letting both through and exceeding the free-tier limit by a small margin.
--
-- Fix: take a transaction-scoped advisory lock keyed on (user_id, event_type) before the count
-- check, so concurrent calls for the same user+event serialize instead of racing. Calls for
-- different users/event types don't contend with each other at all.
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
  -- Serializes concurrent calls for this exact user+event_type; released automatically at the
  -- end of this function's transaction. hashtextextended returns bigint, matching the bigint
  -- overload of pg_advisory_xact_lock (the int4 hashtext() would silently pick the wrong overload).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_event_type, 0));

  SELECT COUNT(*) INTO v_count
  FROM usage_events
  WHERE user_id    = p_user_id
    AND event_type = p_event_type
    AND created_at >= p_month_start;

  IF v_count >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_count);
  END IF;

  INSERT INTO usage_events (user_id, event_type, metadata)
  VALUES (p_user_id, p_event_type, p_metadata);

  RETURN jsonb_build_object('allowed', true, 'used', v_count + 1);
END;
$$;
