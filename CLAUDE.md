# ClaimsQR

Client claims portal for BRQR Insurance Agency (claimsqr.com).

## Stack
- TanStack Start (React, file-based routes, server functions via `createServerFn`)
- Tailwind + shadcn/ui; brand palette navy / gold / teal
- Supabase: auth, Postgres, storage bucket `claim-documents`; migrations in `supabase/migrations`
- `bun.lock` is the lockfile production installs from (Vercel runs `bun install`), so add packages with bun

## Users
- `client`: reports claims (FNOL) and notices, tracks claims, views policies, requests loss runs. Sees only their own client_id.
- `agency_admin`: manages all claims in `/admin`.

## Notes for Claude
- There is no self-service signup. Client logins are created by an agency admin on `/admin` (`src/lib/accounts.functions.ts`) for a `clients` row that already exists; the login is linked through `clients.user_id`. Also keep "Allow new users to sign up" turned off in the Supabase Auth settings.
- Clients, policies and claims live in Supabase and are loaded by CSV import on `/admin` (`src/lib/import.functions.ts`, header matching in `src/lib/import-mapping.ts`). Nothing is read from AMS360/Vertafore any more. `clients.ams360_id` is kept as the column name but now just holds the client number from the CSV.
- Pages get their data from `fetchAgencyOverview` (`src/lib/overview.functions.ts`), which queries with the caller's own token. RLS is what limits a client to their own rows and lets an `agency_admin` see everything, so do not add role checks there or switch it to the service-role client.

## Rules
- Never trust the browser for roles or ownership. Admin actions check the role on the server (`requireAgencyAdmin`); data access is limited by RLS. `fetchAgencyOverview` above is the deliberate caller's-token + RLS case.
- Every schema change is a new migration file; enable RLS on every new table.
- Date-only fields (date_of_loss, date_reported, closed_date, policy dates) are calendar dates. Never `new Date("YYYY-MM-DD")`; use `formatDate` from `src/lib/dates.ts`.
- Status counts and incurred come from `src/lib/claim-metrics.ts`, never inline filters in components.
- Server-only code lives in `*.server.ts` and is only imported inside server handlers.
- Keep the existing visual design unless the task says otherwise.

## Workflow
- Work on a branch per phase (`fix/phase-N`), one commit per numbered fix.
- Before finishing: run `npm run typecheck`, `npm run lint`, `npm run build` and `npm test`; report what you verified and anything you couldn't.
