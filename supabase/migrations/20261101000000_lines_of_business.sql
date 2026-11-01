-- One list of lines of business, so "GL" and "General Liability" stop showing up
-- as separate lines. Text from CSV files is mapped to it by a trigger, which keeps
-- the rules in one place for imports, the claim form and this backfill.

CREATE TABLE public.lines_of_business (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL
);

ALTER TABLE public.lines_of_business ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed-in users read lines of business" ON public.lines_of_business
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages lines of business" ON public.lines_of_business
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

INSERT INTO public.lines_of_business (code, name, sort_order) VALUES
  ('GL', 'General Liability', 10),
  ('AUTO', 'Business Auto', 20),
  ('WC', 'Workers Compensation', 30),
  ('PROP', 'Commercial Property', 40),
  ('UMB', 'Umbrella', 50),
  ('PROF', 'Professional Liability', 60),
  ('CYBER', 'Cyber', 70),
  ('OTHER', 'Other', 80);

ALTER TABLE public.claims
  ADD COLUMN line_of_business_id uuid REFERENCES public.lines_of_business(id);
ALTER TABLE public.policies
  ADD COLUMN line_of_business_id uuid REFERENCES public.lines_of_business(id);

CREATE INDEX claims_line_of_business_id_idx ON public.claims(line_of_business_id);
CREATE INDEX policies_line_of_business_id_idx ON public.policies(line_of_business_id);

-- Rolled-up policies can read "General Liability / Umbrella(C)". They take the
-- first line named; policy_type keeps the full text for display.
CREATE FUNCTION public.resolve_line_of_business(raw text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cleaned AS (
    SELECT lower(trim(split_part(raw, ' / ', 1))) AS t
  )
  SELECT l.id
  FROM cleaned
  JOIN public.lines_of_business l ON l.code = CASE
    WHEN t = 'gl' OR t LIKE 'general liab%' THEN 'GL'
    WHEN t LIKE 'auto%' OR t LIKE '%business auto%' OR t LIKE '%commercial auto%' THEN 'AUTO'
    WHEN t = 'wc' OR t LIKE 'worker%comp%' THEN 'WC'
    WHEN t IN ('property', 'prop', 'commercial property') THEN 'PROP'
    WHEN t LIKE 'umbrella%' THEN 'UMB'
    WHEN t LIKE 'professional%' THEN 'PROF'
    WHEN t LIKE '%cyber%' THEN 'CYBER'
    ELSE 'OTHER'
  END
  WHERE t <> '';
$$;

-- Backfill before the triggers exist.
UPDATE public.claims
SET claim_type = CASE claim_type
  WHEN 'GL' THEN 'General Liability'
  WHEN 'WC' THEN 'Workers Compensation'
  WHEN 'Auto' THEN 'Business Auto'
  WHEN 'Property' THEN 'Commercial Property'
END
WHERE claim_type IN ('GL', 'WC', 'Auto', 'Property');

UPDATE public.claims
SET line_of_business_description = claim_type
WHERE coalesce(line_of_business_description, '') = ''
  AND claim_type IN ('General Liability', 'Workers Compensation', 'Business Auto', 'Commercial Property');

UPDATE public.claims
SET line_of_business_id = public.resolve_line_of_business(
  coalesce(nullif(line_of_business_description, ''), nullif(line_of_business, ''), claim_type)
);

UPDATE public.policies
SET line_of_business_id = public.resolve_line_of_business(policy_type);

CREATE FUNCTION public.set_claim_line_of_business()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.line_of_business_id IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.line_of_business_id IS NOT DISTINCT FROM OLD.line_of_business_id
         AND (NEW.line_of_business_description IS DISTINCT FROM OLD.line_of_business_description
              OR NEW.line_of_business IS DISTINCT FROM OLD.line_of_business
              OR NEW.claim_type IS DISTINCT FROM OLD.claim_type)) THEN
    NEW.line_of_business_id := public.resolve_line_of_business(
      coalesce(nullif(NEW.line_of_business_description, ''), nullif(NEW.line_of_business, ''), NEW.claim_type)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER claims_set_line_of_business
  BEFORE INSERT OR UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.set_claim_line_of_business();

CREATE FUNCTION public.set_policy_line_of_business()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.line_of_business_id IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.line_of_business_id IS NOT DISTINCT FROM OLD.line_of_business_id
         AND NEW.policy_type IS DISTINCT FROM OLD.policy_type) THEN
    NEW.line_of_business_id := public.resolve_line_of_business(NEW.policy_type);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER policies_set_line_of_business
  BEFORE INSERT OR UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.set_policy_line_of_business();
