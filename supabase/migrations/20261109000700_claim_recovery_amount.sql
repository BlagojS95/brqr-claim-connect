-- Recoveries per claim (fix 39): subrogation, salvage and other money back.
-- Net incurred = paid + reserve - recovery (src/lib/claim-metrics.ts).

ALTER TABLE public.claims
  ADD COLUMN recovery_amount numeric(14, 2)
  CHECK (recovery_amount IS NULL OR recovery_amount >= 0);
