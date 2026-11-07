# ClaimsQR

Client claims portal for BRQR Insurance Agency (claimsqr.com). Originally scaffolded in Lovable.

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
- Status and line-of-business values come from shared constants, never raw strings in components.
- Server-only code lives in `*.server.ts` and is only imported inside server handlers.
- Keep the existing visual design unless the task says otherwise.
- The product name is "ClaimsQR" (capital C, capital QR, no space) everywhere users see it.

## Workflow
- Work on a branch per phase (`fix/phase-N`), one commit per numbered fix.
- Before finishing: run `npm run typecheck`, `npm run lint`, `npm run build` and `npm test`; report what you verified and anything you couldn't.

## Deploying
- **A git push does not deploy.** claimsqr.com is the `brqr-claim-connect` project on the Vercel team `brqr`, a Hobby team owned by the Ox Family account. Commits from ika-com are not on that team, so Vercel marks every pushed commit "Blocked" and never builds it. Empty commits, Redeploy, and changing the commit message or co-author lines do not help, so don't try them. Running the CLI from this folder is blocked too; use the git-free copy below.
- Ilija stays logged out of this Vercel account between deploys. Before every deploy, run `npx vercel whoami`. If it doesn't say `oxfamily`, stop and ask Ilija to run `! npx vercel logout` and then `! npx vercel login` and sign in as Ox Family. Never enter the password or approve the login yourself. When the deploy is finished, remind him he can log out again.
- **Deploy from a git-free copy of `main`, never from this folder.** Running the CLI here attaches the commit author (ika-com) and the Hobby team blocks it (`seatBlock: TEAM_ACCESS_REQUIRED`), even when logged in as oxfamily. Without a `.git` folder the CLI sends no author, and the deploy goes through as Ox Family. This worked on 2026-11-06 (deployment `3jwsyzusv`). From the repo root, with `main` pushed and any migration applied:
  ```bash
  E="$TEMP/claimsqr-deploy" && rm -rf "$E" && mkdir -p "$E/.vercel"
  git archive main | tar -x -C "$E"            # committed files only: no .git, no .dev.vars
  cp .vercel/project.json "$E/.vercel/" && cp .vercelignore "$E/"
  cd "$E" && npx --yes vercel@latest deploy --prod --yes --scope brqr </dev/null
  ```
  `</dev/null` stops the CLI hanging on a hidden prompt. `.vercelignore` keeps `.dev.vars` and other local files out of uploads; never remove those entries.
- A deploy is only done once claimsqr.com serves the new code. Check the live bundle for text that only the new build has. Never report a deploy as finished from a successful push.
- Claude Code's Vercel tools are connected to a different team (`ilija-lazarevski-s-projects`). Its `brqr-claims-portal` project does not serve claimsqr.com.
- Don't upgrade the plan, change repo visibility or change the Vercel Git connection without asking Ilija. The code is not meant to be public yet.
