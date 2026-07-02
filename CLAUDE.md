# Notes for Claude

- Self-service signup on `/login` is intentionally still open (anyone can `supabase.auth.signUp` and get a `client`-role account). This is temporary — admin-created accounts (`src/lib/accounts.functions.ts`, `/admin`) are now the intended path for real clients. Remove the self-signup UI/flow from `src/routes/login.tsx` once admin-created accounts are the norm — but only do this when explicitly asked, not proactively.
