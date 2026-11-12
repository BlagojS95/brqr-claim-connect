-- Row-level security check (fixes 15, 32 and 44).
--
-- Builds two TEST companies with users of every kind, then checks what each one
-- can read and write through RLS, by switching to the `authenticated` role with
-- that user's id the way the API does. It ALWAYS ends by raising an exception,
-- so the whole run rolls back and nothing is left in the database.
--
-- Run it in the Supabase SQL editor (or execute_sql). The result is the error
-- message: "RLS CHECK PASSED (n checks)" or "RLS CHECK FAILED" with the list.
-- To dry-run a new migration first, put "begin;" and the migration above this file.

DO $check$
DECLARE
  a uuid := gen_random_uuid();         -- client A
  b uuid := gen_random_uuid();         -- client B
  u_a_admin uuid := gen_random_uuid(); -- A client_admin (A's first login)
  u_a_co uuid := gen_random_uuid();    -- A company-wide
  u_a_loc uuid := gen_random_uuid();   -- A location user, location L1 only
  u_b uuid := gen_random_uuid();       -- B client_admin
  u_agency uuid := gen_random_uuid();  -- agency admin
  l1 uuid := gen_random_uuid();
  l2 uuid := gen_random_uuid();
  lb uuid := gen_random_uuid();
  c_a1 uuid := gen_random_uuid();      -- A at L1
  c_a2 uuid := gen_random_uuid();      -- A at L2
  c_a0 uuid := gen_random_uuid();      -- A, no location
  c_b1 uuid := gen_random_uuid();      -- B at LB
  c_new uuid := gen_random_uuid();     -- not created; a report being uploaded
  ids uuid[];
  failures text[] := '{}';
  checks int := 0;
  n bigint;
  contacts_a1 bigint;
BEGIN
  -- Users (handle_new_user gives each the 'client' role).
  INSERT INTO auth.users (id, email, aud, role)
  SELECT x, 'rls-test-' || x || '@test.invalid', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_a_admin, u_a_co, u_a_loc, u_b, u_agency]) AS x;
  INSERT INTO public.user_roles (user_id, role) VALUES (u_agency, 'agency_admin');

  INSERT INTO public.clients (id, name, user_id) VALUES
    (a, 'TEST RLS client A', u_a_admin),
    (b, 'TEST RLS client B', u_b);
  INSERT INTO public.client_locations (id, client_id, name) VALUES
    (l1, a, 'TEST L1'), (l2, a, 'TEST L2'), (lb, b, 'TEST LB');
  INSERT INTO public.client_users (user_id, client_id, role, location_ids) VALUES
    (u_a_co, a, 'company', '{}'),
    (u_a_loc, a, 'location', ARRAY[l1]);

  INSERT INTO public.claims (id, client_id, claim_type, location_id) VALUES
    (c_a1, a, 'TEST', l1), (c_a2, a, 'TEST', l2), (c_a0, a, 'TEST', NULL), (c_b1, b, 'TEST', lb);
  INSERT INTO public.documents (client_id, claim_id, file_name, file_url) VALUES
    (a, c_a1, 'TEST a1', 'x'), (a, c_a2, 'TEST a2', 'x'), (a, NULL, 'TEST a-company', 'x'),
    (b, c_b1, 'TEST b1', 'x');
  INSERT INTO public.claim_document_requests (claim_id, name) VALUES (c_a2, 'TEST request');
  INSERT INTO public.policies (client_id, policy_number, location_id) VALUES
    (a, 'TEST-A-ALL', NULL), (a, 'TEST-A-L2', l2), (b, 'TEST-B', NULL);
  INSERT INTO public.loss_runs (client_id, year) VALUES (a, 1999), (b, 1999);
  -- One share link per client (fix 44); only agency and client admins may see them.
  INSERT INTO public.shared_reports (token_hash, kind, client_id, title, snapshot, expires_at) VALUES
    (repeat('a', 64), 'loss_summary', a, 'TEST A share', '{}', now() + interval '14 days'),
    (repeat('b', 64), 'loss_summary', b, 'TEST B share', '{}', now() + interval '14 days');

  ids := ARRAY[a, b];

  SELECT count(*) INTO contacts_a1 FROM public.claim_contacts WHERE claim_id = c_a1;

  CREATE TEMP TABLE rls_expect (who text, what text, expected bigint, actual bigint) ON COMMIT DROP;
  GRANT ALL ON rls_expect TO authenticated, anon;

  -- Each block: act as a user, measure, go back to the owner role.
  -- A client_admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO rls_expect SELECT 'A admin', 'claims', 3, count(*) FROM public.claims WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'policies', 2, count(*) FROM public.policies WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'documents', 3, count(*) FROM public.documents WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'activity (3 reported, 2 uploads, 1 request)', 6, count(*) FROM public.claim_activity WHERE claim_id IN (c_a1, c_a2, c_a0, c_b1);
  INSERT INTO rls_expect SELECT 'A admin', 'requests', 1, count(*) FROM public.claim_document_requests WHERE claim_id IN (c_a1, c_a2, c_a0, c_b1);
  INSERT INTO rls_expect SELECT 'A admin', 'loss runs', 1, count(*) FROM public.loss_runs WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'locations', 2, count(*) FROM public.client_locations WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'company users', 3, count(*) FROM public.client_users WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'clients', 1, count(*) FROM public.clients WHERE id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A admin', 'share links (own only)', 1, count(*) FROM public.shared_reports WHERE client_id = ANY (ids);
  BEGIN
    INSERT INTO public.shared_reports (token_hash, kind, client_id, title, snapshot, expires_at)
      VALUES (repeat('c', 64), 'loss_summary', a, 'TEST forged', '{}', now() + interval '1 day');
    INSERT INTO rls_expect VALUES ('A admin', 'cannot write share links directly', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO rls_expect VALUES ('A admin', 'cannot write share links directly', 0, 0);
  END;
  BEGIN
    UPDATE public.shared_reports SET expires_at = now() + interval '300 days' WHERE client_id = a;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO rls_expect VALUES ('A admin', 'cannot extend share links directly', 0, n);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_expect VALUES ('A admin', 'cannot extend share links directly', 0, 0);
  END;
  BEGIN
    INSERT INTO public.client_locations (client_id, name) VALUES (a, 'TEST new A');
    INSERT INTO rls_expect VALUES ('A admin', 'can add own location', 1, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A admin', 'can add own location', 1, 0);
  END;
  BEGIN
    INSERT INTO public.client_locations (client_id, name) VALUES (b, 'TEST hijack B');
    INSERT INTO rls_expect VALUES ('A admin', 'cannot add B location', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A admin', 'cannot add B location', 0, 0);
  END;
  BEGIN
    INSERT INTO public.client_users (user_id, client_id, role) VALUES (u_b, a, 'company');
    INSERT INTO rls_expect VALUES ('A admin', 'cannot write client_users', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A admin', 'cannot write client_users', 0, 0);
  END;
  RESET ROLE;

  -- A company-wide
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a_co, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO rls_expect SELECT 'A company', 'claims', 3, count(*) FROM public.claims WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A company', 'documents', 3, count(*) FROM public.documents WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A company', 'loss runs', 1, count(*) FROM public.loss_runs WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A company', 'company users (own row only)', 1, count(*) FROM public.client_users WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A company', 'share links', 0, count(*) FROM public.shared_reports WHERE client_id = ANY (ids);
  BEGIN
    INSERT INTO public.client_locations (client_id, name) VALUES (a, 'TEST company adds');
    INSERT INTO rls_expect VALUES ('A company', 'cannot add location', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A company', 'cannot add location', 0, 0);
  END;
  INSERT INTO rls_expect VALUES ('A company', 'file loss-runs', 1, public.can_access_claim_file(a || '/loss-runs/x.pdf', false)::int);
  RESET ROLE;

  -- A location user (L1 only)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a_loc, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO rls_expect SELECT 'A location', 'claims', 1, count(*) FROM public.claims WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'sees L1 claim', 1, count(*) FROM public.claims WHERE id = c_a1;
  INSERT INTO rls_expect SELECT 'A location', 'share links', 0, count(*) FROM public.shared_reports WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'policies (company-wide only)', 1, count(*) FROM public.policies WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'documents', 1, count(*) FROM public.documents WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'activity (L1 reported + upload)', 2, count(*) FROM public.claim_activity WHERE claim_id IN (c_a1, c_a2, c_a0, c_b1);
  INSERT INTO rls_expect SELECT 'A location', 'requests (L2 hidden)', 0, count(*) FROM public.claim_document_requests WHERE claim_id IN (c_a1, c_a2, c_a0, c_b1);
  INSERT INTO rls_expect SELECT 'A location', 'loss runs', 0, count(*) FROM public.loss_runs WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'locations', 1, count(*) FROM public.client_locations WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'clients', 1, count(*) FROM public.clients WHERE id = ANY (ids);
  INSERT INTO rls_expect SELECT 'A location', 'contacts (L1 only)', contacts_a1, count(*) FROM public.claim_contacts WHERE claim_id IN (c_a1, c_a2, c_a0, c_b1);
  BEGIN
    INSERT INTO public.claims (client_id, claim_type, location_id) VALUES (a, 'TEST', l1);
    INSERT INTO rls_expect VALUES ('A location', 'can report at L1', 1, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'can report at L1', 1, 0);
  END;
  BEGIN
    INSERT INTO public.claims (client_id, claim_type, location_id) VALUES (a, 'TEST', l2);
    INSERT INTO rls_expect VALUES ('A location', 'cannot report at L2', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'cannot report at L2', 0, 0);
  END;
  BEGIN
    INSERT INTO public.claims (client_id, claim_type, location_id) VALUES (a, 'TEST', NULL);
    INSERT INTO rls_expect VALUES ('A location', 'cannot report without location', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'cannot report without location', 0, 0);
  END;
  BEGIN
    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body) VALUES (c_a2, u_a_loc, 'note', 'TEST');
    INSERT INTO rls_expect VALUES ('A location', 'cannot note on L2 claim', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'cannot note on L2 claim', 0, 0);
  END;
  BEGIN
    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body) VALUES (c_a1, u_a_loc, 'note', 'TEST');
    INSERT INTO rls_expect VALUES ('A location', 'can note on L1 claim', 1, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'can note on L1 claim', 1, 0);
  END;
  BEGIN
    INSERT INTO public.documents (client_id, claim_id, file_name, file_url) VALUES (a, c_a2, 'TEST', 'x');
    INSERT INTO rls_expect VALUES ('A location', 'cannot attach doc to L2 claim', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'cannot attach doc to L2 claim', 0, 0);
  END;
  BEGIN
    INSERT INTO public.loss_run_requests (client_id) VALUES (a);
    INSERT INTO rls_expect VALUES ('A location', 'cannot request loss runs', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR not_null_violation THEN
    INSERT INTO rls_expect VALUES ('A location', 'cannot request loss runs', 0, 0);
  END;
  UPDATE public.claims SET location_id = l1 WHERE id = c_a2;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rls_expect VALUES ('A location', 'cannot move L2 claim', 0, n);
  INSERT INTO rls_expect VALUES ('A location', 'file L1 claim', 1, public.can_access_claim_file(a || '/' || c_a1 || '/x.pdf', false)::int);
  INSERT INTO rls_expect VALUES ('A location', 'file L2 claim', 0, public.can_access_claim_file(a || '/' || c_a2 || '/x.pdf', false)::int);
  INSERT INTO rls_expect VALUES ('A location', 'file loss-runs', 0, public.can_access_claim_file(a || '/loss-runs/x.pdf', false)::int);
  INSERT INTO rls_expect VALUES ('A location', 'file signature', 1, public.can_access_claim_file(a || '/signature/x.png', false)::int);
  INSERT INTO rls_expect VALUES ('A location', 'upload for new report', 1, public.can_access_claim_file(a || '/' || c_new || '/x.pdf', true)::int);
  INSERT INTO rls_expect VALUES ('A location', 'upload into L2 claim', 0, public.can_access_claim_file(a || '/' || c_a2 || '/x.pdf', true)::int);
  INSERT INTO rls_expect VALUES ('A location', 'file in B', 0, public.can_access_claim_file(b || '/' || c_b1 || '/x.pdf', false)::int);
  INSERT INTO rls_expect VALUES ('A location', 'junk path', 0, public.can_access_claim_file('not-a-uuid/x', false)::int);
  RESET ROLE;

  -- B client_admin: nothing of A.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO rls_expect SELECT 'B admin', 'claims', 1, count(*) FROM public.claims WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'B admin', 'documents', 1, count(*) FROM public.documents WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'B admin', 'policies', 1, count(*) FROM public.policies WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'B admin', 'A locations', 0, count(*) FROM public.client_locations WHERE client_id = a;
  INSERT INTO rls_expect SELECT 'B admin', 'A users', 0, count(*) FROM public.client_users WHERE client_id = a;
  INSERT INTO rls_expect SELECT 'B admin', 'A loss runs', 0, count(*) FROM public.loss_runs WHERE client_id = a;
  INSERT INTO rls_expect SELECT 'B admin', 'share links (own only)', 1, count(*) FROM public.shared_reports WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'B admin', 'A share snapshot', 0, count(*) FROM public.shared_reports WHERE client_id = a;
  BEGIN
    INSERT INTO public.claims (client_id, claim_type) VALUES (a, 'TEST');
    INSERT INTO rls_expect VALUES ('B admin', 'cannot report for A', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('B admin', 'cannot report for A', 0, 0);
  END;
  BEGIN
    INSERT INTO public.claims (client_id, claim_type, location_id) VALUES (b, 'TEST', l1);
    INSERT INTO rls_expect VALUES ('B admin', 'cannot use A location', 0, 1);
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    INSERT INTO rls_expect VALUES ('B admin', 'cannot use A location', 0, 0);
  END;
  INSERT INTO rls_expect VALUES ('B admin', 'file in A', 0, public.can_access_claim_file(a || '/' || c_a0 || '/x.pdf', false)::int);
  RESET ROLE;

  -- Agency admin sees everything.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_agency, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO rls_expect SELECT 'agency', 'claims (4 + one reported at L1 above)', 5, count(*) FROM public.claims WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'agency', 'client users', 4, count(*) FROM public.client_users WHERE client_id = ANY (ids);
  INSERT INTO rls_expect SELECT 'agency', 'share links', 2, count(*) FROM public.shared_reports WHERE client_id = ANY (ids);
  RESET ROLE;

  -- Anonymous sees nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public.claims WHERE client_id = ANY (ids);
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0;
  END;
  INSERT INTO rls_expect VALUES ('anon', 'claims', 0, n);
  BEGIN
    SELECT count(*) INTO n FROM public.shared_reports WHERE client_id = ANY (ids);
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0;
  END;
  INSERT INTO rls_expect VALUES ('anon', 'share links', 0, n);
  RESET ROLE;

  SELECT count(*) INTO checks FROM rls_expect;
  SELECT coalesce(array_agg(format('%s / %s: expected %s, got %s', who, what, expected, actual)), '{}')
    INTO failures FROM rls_expect WHERE expected IS DISTINCT FROM actual;

  IF cardinality(failures) = 0 THEN
    RAISE EXCEPTION 'RLS CHECK PASSED (% checks; rolled back)', checks;
  ELSE
    RAISE EXCEPTION 'RLS CHECK FAILED (% of % checks; rolled back): %', cardinality(failures), checks, array_to_string(failures, ' | ');
  END IF;
END
$check$;
