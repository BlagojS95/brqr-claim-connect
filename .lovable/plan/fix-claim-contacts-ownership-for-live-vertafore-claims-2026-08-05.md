# Fix claim contacts ownership for live Vertafore claims

Most claims shown in the portal come live from Vertafore/AMS360 and never exist as rows in the local claims table. The contact rows therefore can't be linked to a local claim, and the current access rules — which look up the owner by going through the claims table — never match. The fix is to store the owning client directly on each contact row.

## What changes

- Remove the hard link from contact rows (and their logged emails) to the local claims table, so contacts can exist for live Vertafore claims.
- Add a `client_id` owner column on contact rows, pointing at the client record; deleting a client removes their contact rows.
- Backfill the owner for contact rows that were already created from locally-created claims.
- Replace the access rules on contacts: a signed-in user can view and edit only contact rows belonging to their own client record.
- Replace the access rules on logged contact emails: a user can view, add, and update only emails attached to contacts their client owns.
- Update the auto-seeding routine so that when a claim is created locally, the five standard contact rows are stamped with that claim's client.

## Notes

- Admin access rules on both tables are untouched — agency admins keep full access.
- The server function that seeds and reads contacts already writes `client_id`, so no app-code changes are needed after this runs.

## Technical detail

Runs exactly the SQL provided: drop the two `claim_id` foreign keys, `ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE`, backfill from `public.claims`, drop/recreate the client-facing RLS policies on `claim_contacts` (SELECT + UPDATE) and `claim_contact_emails` (SELECT + INSERT + UPDATE) using `client_id`, and `CREATE OR REPLACE FUNCTION public.seed_claim_contacts()` to insert `client_id` from `NEW.client_id`.
