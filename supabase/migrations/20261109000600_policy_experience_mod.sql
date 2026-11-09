-- Workers comp experience mod per policy term (fix 36, renewal pack).
-- Optional; 1.00 is average, below is better. Shown in the renewal pack when set.

ALTER TABLE public.policies
  ADD COLUMN experience_mod numeric(4, 2)
  CHECK (experience_mod IS NULL OR (experience_mod > 0 AND experience_mod < 10));
