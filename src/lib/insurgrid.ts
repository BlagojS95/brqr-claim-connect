import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadDevVars } from "@/lib/load-dev-vars.server";

// InsurGrid's loss-runs embed (https://dashboard.insurgrid.com/embed.js) needs a
// short-lived session token minted server-side with the agency's API key.
// See https://docs.insurgrid.com/intake-forms/builder-sessions.md
const DEFAULT_API_URL = "https://phoenix.insurgrid.com/api/v1";

export const insurGridConfigured = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await loadDevVars();
    return Boolean(process.env.INSURGRID_API_KEY);
  });

export const createInsurGridSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await loadDevVars();
    const apiKey = process.env.INSURGRID_API_KEY;
    if (!apiKey) throw new Error("Missing INSURGRID_API_KEY environment variable");

    const res = await fetch(`${process.env.INSURGRID_API_URL || DEFAULT_API_URL}/embed-sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // One token per portal user; good for 15 minutes, embed.js refreshes it.
      body: JSON.stringify({ externalUserId: context.userId }),
    });
    if (!res.ok) {
      throw new Error(`InsurGrid embed session failed: ${res.status} ${await res.text()}`);
    }
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: string };
    return { token, expiresAt };
  });
