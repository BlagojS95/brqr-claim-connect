
DO $$
DECLARE
  uid uuid := '11111111-1111-1111-1111-111111111111';
  cid uuid;
  pid1 uuid := gen_random_uuid();
  pid2 uuid := gen_random_uuid();
BEGIN
  -- Create auth user if not exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'demo@brqr.com', crypt('Demo1234!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Acme Logistics LLC"}'::jsonb,
      '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), uid,
      jsonb_build_object('sub', uid::text, 'email', 'demo@brqr.com'),
      'email', 'demo@brqr.com', now(), now(), now());
  END IF;

  -- Role
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'client') ON CONFLICT DO NOTHING;

  -- Client record
  INSERT INTO public.clients (user_id, name, email, phone, company_name, ams360_id)
  VALUES (uid, 'John Carter', 'demo@brqr.com', '+1 (555) 234-9981', 'Acme Logistics LLC', 'AMS-48201')
  ON CONFLICT DO NOTHING;

  SELECT id INTO cid FROM public.clients WHERE user_id = uid LIMIT 1;

  -- Policies
  INSERT INTO public.policies (id, client_id, policy_number, policy_type, carrier, effective_date, expiration_date) VALUES
    (pid1, cid, 'CA-7741209', 'Commercial Auto', 'Travelers', '2026-01-15', '2027-01-15'),
    (pid2, cid, 'GL-3398022', 'General Liability', 'Hartford', '2026-03-01', '2027-03-01');

  -- Claims
  INSERT INTO public.claims (client_id, policy_id, claim_type, status, date_of_loss, date_reported, description, carrier, claim_number, adjuster_name, adjuster_email, adjuster_phone, reserve_amount, paid_amount, last_follow_up, is_notice_only) VALUES
    (cid, pid1, 'Auto Collision', 'Open', '2026-04-12', '2026-04-13', 'Box truck rear-ended at intersection in downtown Tampa. Driver uninjured.', 'Travelers', 'TRV-2026-88210', 'Sarah Mendez', 'smendez@travelers.com', '+1 (800) 252-4633', 18500, 4200, now() - interval '2 days', false),
    (cid, pid2, 'Slip and Fall', 'Under Review', '2026-03-28', '2026-03-29', 'Customer slipped on wet floor at warehouse entrance. Minor injuries reported.', 'Hartford', 'HFD-2026-44109', 'Mark Donovan', 'mdonovan@thehartford.com', '+1 (800) 327-3636', 32000, 0, now() - interval '5 days', false),
    (cid, pid1, 'Cargo Damage', 'Closed', '2026-01-20', '2026-01-21', 'Pallet of electronics damaged during transport due to improper securing.', 'Travelers', 'TRV-2026-77103', 'Sarah Mendez', 'smendez@travelers.com', '+1 (800) 252-4633', 12000, 11750, now() - interval '40 days', false),
    (cid, pid2, 'Property Damage', 'Open', '2026-05-02', '2026-05-03', 'Forklift damaged loading dock door at client facility.', 'Hartford', NULL, NULL, NULL, NULL, 0, 0, NULL, true);

  -- Loss runs
  INSERT INTO public.loss_runs (client_id, policy_id, year, total_claims, total_paid, total_incurred) VALUES
    (cid, pid1, 2025, 5, 47200, 62000),
    (cid, pid2, 2025, 2, 18400, 25000),
    (cid, pid1, 2024, 3, 21000, 28500);
END $$;
