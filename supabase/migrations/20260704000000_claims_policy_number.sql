-- policy_id can no longer be populated meaningfully: the Policy dropdown now
-- sources from live Vertafore data, whose PolicyId GUIDs don't exist in the
-- (now-dead) local `policies` table that policy_id foreign-keys to. Store the
-- human-readable policy number directly instead.
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS policy_number text;
