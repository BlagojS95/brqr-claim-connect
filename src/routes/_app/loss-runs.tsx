import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderArchive } from "lucide-react";
import { LossRunLibrary } from "@/components/loss-runs/loss-run-library";
import { useAuth } from "@/hooks/use-auth";
import { CLIENT_USER_ROLE } from "@/lib/client-users";

// Loss Runs (Dmitry, 16 Nov): their own page and nav item, out of Reports.
// Everything to do with loss runs is here: the library, requests and InsurGrid.
export const Route = createFileRoute("/_app/loss-runs")({
  head: () => ({ meta: [{ title: "Loss Runs | ClaimsQR" }] }),
  component: LossRunsPage,
});

function LossRunsPage() {
  // Location users (fix 32) only see their sites' claims and no company-wide
  // loss runs. RLS already returns them none; the nav item is hidden for them.
  const { clientRole } = useAuth();
  const locationUser = clientRole === CLIENT_USER_ROLE.location;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <FolderArchive className="h-6 w-6 text-gold" aria-hidden /> Loss Runs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Access historical loss run reports and request new ones from your agent.
        </p>
      </div>

      {locationUser ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Loss runs cover the whole company, so they aren't available for location logins. See the{" "}
          <Link to="/reports" search={{ tab: "loss-summary" }} className="text-navy underline">
            loss summary for your locations
          </Link>{" "}
          or ask your agent.
        </p>
      ) : (
        <LossRunLibrary />
      )}
    </div>
  );
}
