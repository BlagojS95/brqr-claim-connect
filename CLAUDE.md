# Notes for Claude

- There is no self-service signup. Client logins are created by an agency admin on `/admin` (`src/lib/accounts.functions.ts`) for a `clients` row that already exists; the login is linked through `clients.user_id`. Also keep "Allow new users to sign up" turned off in the Supabase Auth settings.
- Clients, policies and claims live in Supabase and are loaded by CSV import on `/admin` (`src/lib/import.functions.ts`, header matching in `src/lib/import-mapping.ts`). Nothing is read from AMS360/Vertafore any more. `clients.ams360_id` is kept as the column name but now just holds the client number from the CSV.
- Pages get their data from `fetchAgencyOverview` (`src/lib/overview.functions.ts`), which queries with the caller's own token. RLS is what limits a client to their own rows and lets an `agency_admin` see everything, so do not add role checks there or switch it to the service-role client.
