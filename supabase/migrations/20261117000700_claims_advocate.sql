-- Fix 59: Help on every page.
--
-- Each client can have a named claims advocate at the agency (name, phone,
-- email). When a client has none, the agency-wide default advocate in
-- agency_settings is shown instead. agency_settings also holds the
-- after-hours claims phone number shown to every client.
--
-- No new tables, so no new policies are needed:
--   * clients: a client member already reads its own row ("client sees self",
--     is_client_member); only an agency_admin writes ("admin manages clients").
--     While an admin views as a client, the view-as policies keep it read-only.
--   * agency_settings: every signed-in user reads it; only an agency_admin
--     writes it.

ALTER TABLE public.clients
  ADD COLUMN advocate_name text CHECK (char_length(advocate_name) <= 120),
  ADD COLUMN advocate_phone text CHECK (char_length(advocate_phone) <= 40),
  ADD COLUMN advocate_email text CHECK (char_length(advocate_email) <= 254);

ALTER TABLE public.agency_settings
  ADD COLUMN default_advocate_name text CHECK (char_length(default_advocate_name) <= 120),
  ADD COLUMN default_advocate_phone text CHECK (char_length(default_advocate_phone) <= 40),
  ADD COLUMN default_advocate_email text CHECK (char_length(default_advocate_email) <= 254),
  ADD COLUMN after_hours_claims_phone text CHECK (char_length(after_hours_claims_phone) <= 40);
