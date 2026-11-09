import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCronRequest } from "@/lib/digest";

// Weekly digest (fix 33), called by the Vercel cron in vercel.json. Vercel
// sends `Authorization: Bearer <CRON_SECRET>` when that env var is set.
// The job itself does nothing while the agency switch on /settings is off.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/cron/weekly-digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadDevVars } = await import("@/lib/load-dev-vars.server");
        await loadDevVars();
        const secret = process.env.CRON_SECRET;
        if (!secret?.trim()) return json({ error: "CRON_SECRET is not configured" }, 503);
        if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
          return json({ error: "Unauthorized" }, 401);
        }

        try {
          // Imported here so the service-role job never reaches a client bundle.
          const { runWeeklyDigest } = await import("@/lib/digest.server");
          return json(await runWeeklyDigest());
        } catch (err) {
          console.error("weekly digest failed", err);
          return json({ error: "Weekly digest failed" }, 500);
        }
      },
    },
  },
});
