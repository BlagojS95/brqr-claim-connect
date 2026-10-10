-- Total billed for the policy term: coverage premium plus taxes and fees,
-- summed from the Book of Business report lines at import time.
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS premium numeric(14,2);
