
-- Roles
CREATE TYPE public.app_role AS ENUM ('agency_admin', 'client');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins see all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'agency_admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Clients
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  ams360_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client sees self" ON public.clients FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin sees all clients" ON public.clients FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'agency_admin'));
CREATE POLICY "admin manages clients" ON public.clients FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Policies
CREATE TABLE public.policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_number TEXT NOT NULL,
  carrier TEXT,
  policy_type TEXT,
  effective_date DATE,
  expiration_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client sees own policies" ON public.policies FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "admin all policies" ON public.policies FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Claims
CREATE TABLE public.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES public.policies(id) ON DELETE SET NULL,
  claim_type TEXT NOT NULL,
  is_notice_only BOOLEAN NOT NULL DEFAULT false,
  date_of_loss DATE,
  date_reported DATE DEFAULT CURRENT_DATE,
  description TEXT,
  carrier TEXT,
  carrier_email TEXT,
  fnol_sent_date TIMESTAMPTZ,
  claim_number TEXT,
  adjuster_name TEXT,
  adjuster_email TEXT,
  adjuster_phone TEXT,
  reserve_amount NUMERIC(14,2) DEFAULT 0,
  paid_amount NUMERIC(14,2) DEFAULT 0,
  last_follow_up TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Open',
  ams360_doc_id TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client sees own claims" ON public.claims FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "client creates own claims" ON public.claims FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "admin all claims" ON public.claims FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES public.claims(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client sees own docs" ON public.documents FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "client uploads own docs" ON public.documents FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "admin all docs" ON public.documents FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Loss runs
CREATE TABLE public.loss_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES public.policies(id) ON DELETE SET NULL,
  year INTEGER NOT NULL,
  total_claims INTEGER DEFAULT 0,
  total_paid NUMERIC(14,2) DEFAULT 0,
  total_incurred NUMERIC(14,2) DEFAULT 0,
  document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.loss_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client sees own loss runs" ON public.loss_runs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
);
CREATE POLICY "admin all loss runs" ON public.loss_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'agency_admin')) WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Auto-assign client role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT DO NOTHING;
  INSERT INTO public.clients (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket for claim documents
INSERT INTO storage.buckets (id, name, public) VALUES ('claim-documents', 'claim-documents', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated upload claim docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'claim-documents');
CREATE POLICY "public read claim docs" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'claim-documents');
CREATE POLICY "admin manage claim docs" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'agency_admin'))
  WITH CHECK (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'agency_admin'));
