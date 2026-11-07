-- claims.status becomes an enum instead of free text from CSV files.
-- Values and labels live in src/lib/claim-status.ts; the CSV importer maps
-- free text onto the enum with parseClaimStatus, which follows the same rules
-- as the backfill below.
--
-- Backfill, first match wins (case, spaces, "-" and "_" are ignored):
--   "Closed..."                          -> closed
--   "Reopened" / "Re-opened" / "Reopen"  -> reopened
--   is_notice_only = true, or "Notice"   -> notice
--   "Submitted"                          -> submitted
--   "Pending" with no claim number       -> submitted
--   "Pending" with a claim number        -> open
--   "Open" and anything else (e.g. "Under Review", blank) -> open
-- A closed or reopened notice keeps that status rather than going back to
-- notice, matching how the portal already counted it. Unexpected values map to
-- open, so the cast below can never fail.

CREATE TYPE public.claim_status AS ENUM ('notice', 'submitted', 'open', 'closed', 'reopened');

ALTER TABLE public.claims ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.claims
  ALTER COLUMN status TYPE public.claim_status
  USING (
    CASE
      WHEN regexp_replace(lower(btrim(coalesce(status, ''))), '[[:space:]_-]+', ' ', 'g') LIKE 'clos%'
        THEN 'closed'
      WHEN regexp_replace(lower(btrim(coalesce(status, ''))), '[[:space:]_-]+', ' ', 'g') ~ '^re ?open'
        THEN 'reopened'
      WHEN is_notice_only
        OR regexp_replace(lower(btrim(coalesce(status, ''))), '[[:space:]_-]+', ' ', 'g') LIKE 'notice%'
        THEN 'notice'
      WHEN lower(btrim(coalesce(status, ''))) = 'submitted'
        THEN 'submitted'
      WHEN lower(btrim(coalesce(status, ''))) = 'pending' AND nullif(btrim(claim_number), '') IS NULL
        THEN 'submitted'
      ELSE 'open'
    END
  )::public.claim_status;

ALTER TABLE public.claims ALTER COLUMN status SET DEFAULT 'submitted';
