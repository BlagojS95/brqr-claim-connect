import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCronRequest } from "@/lib/digest";

// Monthly executive loss report (fix 46), called by the Vercel cron in
// vercel.json. Vercel sends `Authorization: Bearer <CRON_SECRET>` when that
// env var is set. Does nothing while the agency switch on Reports is off.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/cron/monthly-report")({
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
          const { runMonthlyReports } = await import("@/lib/monthly-report.server");
          return json(await runMonthlyReports());
        } catch (err) {
          console.error("monthly report failed", err);
          return json({ error: "Monthly report failed" }, 500);
        }
      },
    },
  },
});
