ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS broker_name text;
UPDATE public.policies SET broker_name = 'Daniel Barquero' WHERE broker_name IS NULL;