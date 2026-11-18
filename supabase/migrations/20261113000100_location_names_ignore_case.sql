-- Fix 32 follow-up: a company can't have two locations whose names differ
-- only in capitals ("Dayton Yard" and "dayton yard"). Replaces the
-- case-sensitive UNIQUE (client_id, name). Still raises 23505 on a clash.
ALTER TABLE public.client_locations
  DROP CONSTRAINT IF EXISTS client_locations_client_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS client_locations_client_id_lower_name_key
  ON public.client_locations (client_id, lower(name));
