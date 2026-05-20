CREATE TABLE public.loss_run_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  requested_by UUID,
  years INTEGER[] NOT NULL DEFAULT '{}',
  lines_of_business TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  admin_notes TEXT,
  fulfilled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.loss_run_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all loss run requests"
ON public.loss_run_requests FOR ALL TO authenticated
USING (has_role(auth.uid(), 'agency_admin'))
WITH CHECK (has_role(auth.uid(), 'agency_admin'));

CREATE POLICY "client sees own loss run requests"
ON public.loss_run_requests FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = loss_run_requests.client_id AND c.user_id = auth.uid()));

CREATE POLICY "client creates own loss run requests"
ON public.loss_run_requests FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = loss_run_requests.client_id AND c.user_id = auth.uid()));